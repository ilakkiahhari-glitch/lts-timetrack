import ipaddress
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AttendanceEvent, AttendanceSession, AuditLog, User
from app.services.session_flags import CORRECTED_MARK, MISSED_EXIT_PREFIX


class SessionNotFound(Exception):
    pass


class SessionAlreadyVoided(Exception):
    pass


def serialize_session(s: AttendanceSession) -> dict:
    """JSON-safe snapshot for audit old/new values."""
    return {
        "id": str(s.id), "person_id": str(s.person_id), "status": s.status,
        "entry_time": s.entry_time.isoformat(), "exit_time": s.exit_time.isoformat() if s.exit_time else None,
        "work_date": s.work_date.isoformat() if isinstance(s.work_date, date) else None,
    }


def local_date(moment: datetime) -> date:
    return moment.astimezone(ZoneInfo(settings.school_tz)).date()


async def correct_session(
    db: AsyncSession,
    admin: User,
    session_id: uuid.UUID,
    new_entry: datetime,
    new_exit: datetime,
    reason: str,
    request: Request | None = None,
) -> AttendanceSession:
    """Void the faulty session and create a replacement with ADMIN_CORRECTION events, so history is never lost.

    Commits its own transaction (the session already has one open from the auth dependencies).
    """
    if not reason.strip():
        raise ValueError("A reason is required for corrections")
    old = await db.get(AttendanceSession, session_id, with_for_update=True)
    if old is None:
        raise SessionNotFound
    notes = old.notes or ""
    # A session voided by a missed exit (OI-1) may be rebuilt once; any other voided session cannot be corrected.
    rebuilding_missed_exit = (
        old.status == "VOIDED" and notes.startswith(MISSED_EXIT_PREFIX) and CORRECTED_MARK not in notes
    )
    if old.status == "VOIDED" and not rebuilding_missed_exit:
        raise SessionAlreadyVoided

    before = serialize_session(old)
    old.status = "VOIDED"
    if rebuilding_missed_exit:
        old.notes = f"{notes} {CORRECTED_MARK}"
    await db.flush()

    replacement = AttendanceSession(
        person_id=old.person_id, entry_time=new_entry, exit_time=new_exit, status="CLOSED",
        work_date=local_date(new_entry),
    )
    db.add(replacement)
    await db.flush()
    db.add_all([
        AttendanceEvent(session_id=replacement.id, person_id=old.person_id, event_type="ENTRY",
                        event_time=new_entry, source="ADMIN_CORRECTION"),
        AttendanceEvent(session_id=replacement.id, person_id=old.person_id, event_type="EXIT",
                        event_time=new_exit, source="ADMIN_CORRECTION"),
    ])
    add_audit(db, actor_id=admin.id, action="CORRECT", entity_type="attendance_session",
              entity_id=session_id, old_values=before, new_values=serialize_session(replacement),
              reason=reason, request=request)
    await db.commit()
    return replacement


def _client_ip(request: Request | None) -> str | None:
    """Client IP for the INET column; None when absent or not an IP (e.g. a unix socket), so auditing never fails."""
    host = request.client.host if request and request.client else None
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:
        return None


def add_audit(
    db: AsyncSession,
    *,
    actor_id,
    action: str,
    entity_type: str,
    entity_id,
    old_values: dict | None = None,
    new_values: dict | None = None,
    reason: str | None = None,
    request: Request | None = None,
) -> None:
    """Queue an append-only audit row. The caller commits, so it lands in the same transaction."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_values=old_values,
            new_values=new_values,
            reason=reason,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent") if request else None,
        )
    )
