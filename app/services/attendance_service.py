"""Attendance Service: execute a scan decision transactionally."""

import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AttendanceEvent, AttendanceRule, AttendanceSession, Person
from app.schemas.kiosk import ScanResponse
from app.services.audit_service import add_audit
from app.services.session_flags import MISSED_EXIT_PREFIX, is_stale
from app.services.state_engine import Action, PersonState, Rules, decide


def display_name(person: Person) -> str:
    """Short name shown at the kiosk (e.g. "A. Rivera")."""
    return f"{person.first_name[:1]}. {person.last_name}"


async def load_rules(db: AsyncSession, person_type: str) -> tuple[Rules, time | None]:
    """Engine rules plus the type's auto_close_time (None = no cutoff configured)."""
    row = await db.get(AttendanceRule, person_type)
    if row is None:
        return Rules(), None
    return Rules(duplicate_window=timedelta(seconds=row.duplicate_window_seconds)), row.auto_close_time


async def process_scan(
    db: AsyncSession, person: Person, device_id: uuid.UUID, operator_id: uuid.UUID
) -> ScanResponse:
    """One transaction per scan. A row lock on the person serialises concurrent scans of the same
    person; the partial unique index on open sessions is the database-level backstop.

    The session already has a transaction open (auth dependencies ran queries), so this commits
    explicitly instead of using `async with db.begin()`.
    """
    now = datetime.now(timezone.utc)
    who = {"person": display_name(person), "person_type": person.person_type}

    await db.execute(select(Person.id).where(Person.id == person.id).with_for_update())

    rules, auto_close = await load_rules(db, person.person_type)
    open_session = await db.scalar(
        select(AttendanceSession).where(
            AttendanceSession.person_id == person.id, AttendanceSession.status == "OPEN"
        )
    )
    last_time = await db.scalar(
        select(AttendanceEvent.event_time)
        .where(AttendanceEvent.person_id == person.id)
        .order_by(AttendanceEvent.event_time.desc())
        .limit(1)
    )

    # OI-1: an open session past its cutoff is stale (the person forgot to scan out). It is not treated as
    # "has an open session", so this scan starts a new ENTRY; the stale session is voided below.
    stale = open_session is not None and is_stale(open_session.entry_time, open_session.work_date, auto_close, now)
    action = decide(PersonState(open_session is not None and not stale, last_time), now, rules)

    if action is Action.DUPLICATE:
        await db.rollback()  # nothing written; release the lock
        return ScanResponse(result="DUPLICATE", message="Already recorded", **who)

    if action is Action.ENTRY:
        message = "Person currently on site"
        if stale:
            open_session.status = "VOIDED"
            open_session.notes = f"{MISSED_EXIT_PREFIX} no exit was scanned; voided when a new entry was scanned"
            add_audit(
                db, actor_id=operator_id, action="UPDATE", entity_type="attendance_session",
                entity_id=open_session.id, old_values={"status": "OPEN"},
                new_values={"status": "VOIDED", "flag": "MISSED_EXIT"},
                reason="Missed exit: new entry scanned after the session went stale; needs admin correction",
            )
            await db.flush()  # frees the one-open-session-per-person index before the new session
            message = "Previous exit was missed; person currently on site"
        local_date = now.astimezone(ZoneInfo(settings.school_tz)).date()
        session = AttendanceSession(
            person_id=person.id, entry_time=now, entry_device_id=device_id, work_date=local_date
        )
        db.add(session)
        await db.flush()
        db.add(
            AttendanceEvent(
                session_id=session.id, person_id=person.id, event_type="ENTRY", event_time=now,
                device_id=device_id, operator_id=operator_id,
            )
        )
        await db.commit()
        return ScanResponse(result="ENTRY", message=message, time=now, **who)

    # EXIT
    open_session.exit_time = now
    open_session.exit_device_id = device_id
    open_session.status = "CLOSED"
    db.add(
        AttendanceEvent(
            session_id=open_session.id, person_id=person.id, event_type="EXIT", event_time=now,
            device_id=device_id, operator_id=operator_id,
        )
    )
    await db.commit()
    return ScanResponse(
        result="EXIT", message="Person checked out", time=now,
        duration_seconds=int((now - open_session.entry_time).total_seconds()), **who,
    )


async def on_site(db: AsyncSession) -> list[dict]:
    rows = await db.execute(
        select(Person, AttendanceSession.entry_time)
        .join(AttendanceSession, AttendanceSession.person_id == Person.id)
        .where(AttendanceSession.status == "OPEN")
        .order_by(AttendanceSession.entry_time)
    )
    return [
        {"person": display_name(p), "person_type": p.person_type, "entry_time": entry}
        for p, entry in rows.all()
    ]
