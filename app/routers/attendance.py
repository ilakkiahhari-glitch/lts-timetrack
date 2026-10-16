import uuid
from datetime import date, datetime, time, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import AttendanceEvent, AttendanceRule, AttendanceSession, Person, User
from app.schemas.attendance import CorrectionRequest, EventOut, SessionDetail, SessionOut
from app.security import require_role
from app.services import audit_service
from app.services.session_flags import MISSED_EXIT_PREFIX, review_state

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])

admin_only = require_role("ADMIN")


def _session_out(s: AttendanceSession, p: Person, auto_close: time | None, now: datetime) -> dict:
    return {
        "id": s.id, "person_id": s.person_id, "external_code": p.external_code,
        "person_name": f"{p.first_name} {p.last_name}", "person_type": p.person_type,
        "entry_time": s.entry_time, "exit_time": s.exit_time, "status": s.status,
        "duration_seconds": s.duration_seconds, "work_date": s.work_date, "notes": s.notes,
        "entry_device_id": s.entry_device_id, "exit_device_id": s.exit_device_id,
        "review": review_state(s.status, s.notes, s.entry_time, s.work_date, auto_close, now),
    }


def _with_rule(stmt):
    """Sessions with their person and the person type's auto_close_time (needed to tell if a session is stale)."""
    return (
        stmt.add_columns(AttendanceRule.auto_close_time)
        .join(Person, Person.id == AttendanceSession.person_id)
        .outerjoin(AttendanceRule, AttendanceRule.person_type == Person.person_type)
    )


async def _detail(db: AsyncSession, session_id: uuid.UUID) -> SessionDetail | None:
    row = (await db.execute(
        _with_rule(select(AttendanceSession, Person)).where(AttendanceSession.id == session_id)
    )).first()
    if row is None:
        return None
    session, person, auto_close = row
    events = (await db.scalars(
        select(AttendanceEvent).where(AttendanceEvent.session_id == session_id)
        .order_by(AttendanceEvent.event_time, AttendanceEvent.id)
    )).all()
    out = _session_out(session, person, auto_close, datetime.now(timezone.utc))
    return SessionDetail(**out, events=[EventOut.model_validate(e) for e in events])


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    person_id: uuid.UUID | None = None,
    type: str | None = None,
    date_from: date | None = Query(None, description="work_date >= (school-local date)"),
    date_to: date | None = Query(None, description="work_date <="),
    status_filter: Literal["OPEN", "CLOSED", "VOIDED"] | None = Query(None, alias="status"),
    needs_review: bool = Query(False, description="Only sessions an admin must look at (left open, or missed exit)"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only),
):
    stmt = _with_rule(select(AttendanceSession, Person)).order_by(AttendanceSession.entry_time.desc())
    if person_id:
        stmt = stmt.where(AttendanceSession.person_id == person_id)
    if type:
        stmt = stmt.where(Person.person_type == type.upper())
    if date_from:
        stmt = stmt.where(AttendanceSession.work_date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceSession.work_date <= date_to)
    if status_filter:
        stmt = stmt.where(AttendanceSession.status == status_filter)

    now = datetime.now(timezone.utc)
    if not needs_review:
        rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
        return [_session_out(s, p, ac, now) for s, p, ac in rows]

    # Staleness depends on each type's cutoff and the school time zone, so it is worked out here: start from the
    # sessions that could need review (open ones, and voided missed exits), keep those that do, then page.
    stmt = stmt.where(or_(
        AttendanceSession.status == "OPEN",
        and_(AttendanceSession.status == "VOIDED", AttendanceSession.notes.like(f"{MISSED_EXIT_PREFIX}%")),
    ))
    out = [_session_out(s, p, ac, now) for s, p, ac in (await db.execute(stmt)).all()]
    return [row for row in out if row["review"]][offset:offset + limit]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    detail = await _detail(db, session_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return detail


@router.post("/sessions/{session_id}/correct", response_model=SessionDetail, status_code=status.HTTP_201_CREATED)
async def correct_session(
    session_id: uuid.UUID,
    body: CorrectionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    """Void the session and create a replacement with the corrected times. The body requires a `reason`."""
    try:
        replacement = await audit_service.correct_session(
            db, admin, session_id, body.entry_time, body.exit_time, body.reason, request
        )
    except audit_service.SessionNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from None
    except audit_service.SessionAlreadyVoided:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is already voided") from None
    return await _detail(db, replacement.id)
