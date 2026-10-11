"""Nightly job: flag sessions left open past their person type's auto_close_time for admin review.

Sessions stay OPEN (never auto-closed silently). The flag is a marker in `notes`, plus an audit row.
An admin resolves each one with a correction (POST /attendance/sessions/{id}/correct).
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AttendanceRule, AttendanceSession, AuditLog, Person

FLAG_PREFIX = "[FLAGGED: left open past auto-close time]"


def cutoff_for(entry_time: datetime, work_date, auto_close: time) -> datetime:
    """Cutoff on the work date (school-local). If that is not after the entry, use the next day."""
    tz = ZoneInfo(settings.school_tz)
    cutoff = datetime.combine(work_date, auto_close, tzinfo=tz)
    if cutoff <= entry_time:
        cutoff += timedelta(days=1)
    return cutoff


async def flag_stale_open_sessions(db: AsyncSession, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    rows = (await db.execute(
        select(AttendanceSession, AttendanceRule.auto_close_time)
        .join(Person, Person.id == AttendanceSession.person_id)
        .join(AttendanceRule, AttendanceRule.person_type == Person.person_type)
        .where(AttendanceSession.status == "OPEN", AttendanceRule.auto_close_time.is_not(None))
    )).all()

    flagged = 0
    for session, auto_close in rows:
        if (session.notes or "").startswith(FLAG_PREFIX):
            continue
        if now < cutoff_for(session.entry_time, session.work_date, auto_close):
            continue
        session.notes = FLAG_PREFIX + (f" {session.notes}" if session.notes else "")
        db.add(AuditLog(
            actor_id=None, action="UPDATE", entity_type="attendance_session", entity_id=str(session.id),
            new_values={"flag": "STALE_OPEN"}, reason="Left open past auto-close time; needs admin review",
        ))
        flagged += 1
    await db.commit()
    return flagged
