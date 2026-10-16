"""Markers and cutoff logic for sessions that were left open (design OI-1 and OI-3).

Pure logic apart from reading the school timezone from settings.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.config import settings

# Nightly job (OI-3): the session stays OPEN, with this note, for admin review.
FLAG_PREFIX = "[FLAGGED: left open past auto-close time]"
# Scan after a stale open session (OI-1): the old session is VOIDED with this note and a new ENTRY starts.
MISSED_EXIT_PREFIX = "[MISSED EXIT]"
# Added to a missed-exit session once an admin has rebuilt it with a correction (prevents double counting).
CORRECTED_MARK = "[CORRECTED]"


def cutoff_for(entry_time: datetime, work_date: date, auto_close: time) -> datetime:
    """Cutoff on the work date (school-local). If that is not after the entry, use the next day."""
    cutoff = datetime.combine(work_date, auto_close, tzinfo=ZoneInfo(settings.school_tz))
    if cutoff <= entry_time:
        cutoff += timedelta(days=1)
    return cutoff


def stale_cutoff(entry_time: datetime, work_date: date, auto_close: time | None) -> datetime:
    """When an open session becomes stale: the type's auto_close_time, or the end of its work date if none is set."""
    if auto_close is not None:
        return cutoff_for(entry_time, work_date, auto_close)
    return datetime.combine(work_date + timedelta(days=1), time.min, tzinfo=ZoneInfo(settings.school_tz))


def is_stale(entry_time: datetime, work_date: date, auto_close: time | None, now: datetime) -> bool:
    return now >= stale_cutoff(entry_time, work_date, auto_close)
