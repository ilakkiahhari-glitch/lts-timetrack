"""Attendance Service: execute a scan decision transactionally."""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AttendanceEvent, AttendanceRule, AttendanceSession, Person
from app.schemas.kiosk import ScanResponse
from app.services.state_engine import Action, PersonState, Rules, decide


def display_name(person: Person) -> str:
    """Short name shown at the kiosk (e.g. "A. Rivera")."""
    return f"{person.first_name[:1]}. {person.last_name}"


async def load_rules(db: AsyncSession, person_type: str) -> Rules:
    row = await db.get(AttendanceRule, person_type)
    return Rules(duplicate_window=timedelta(seconds=row.duplicate_window_seconds)) if row else Rules()


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

    rules = await load_rules(db, person.person_type)
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

    action = decide(PersonState(open_session is not None, last_time), now, rules)

    if action is Action.DUPLICATE:
        await db.rollback()  # nothing written; release the lock
        return ScanResponse(result="DUPLICATE", message="Already recorded", **who)

    if action is Action.ENTRY:
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
        return ScanResponse(result="ENTRY", message="Person currently on site", time=now, **who)

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
