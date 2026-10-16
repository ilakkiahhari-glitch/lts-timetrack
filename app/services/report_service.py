"""Reporting Service: aggregate sessions by person, type and date range; CSV/XLSX export."""

import csv
import io
from datetime import date

from openpyxl import Workbook
from sqlalchemy import Time, cast, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AttendanceRule, AttendanceSession, Person

COLUMNS = [
    ("external_code", "Code"), ("person_name", "Name"), ("person_type", "Type"), ("group_name", "Group"),
    ("total_hours", "Total hours"), ("days_present", "Days present"), ("late_entries", "Late entries"),
    ("sessions_closed", "Closed sessions"), ("sessions_open", "Sessions still open"),
]


async def summary_rows(
    db: AsyncSession, date_from: date, date_to: date, person_type: str | None = None
) -> list[dict]:
    """Per person over a work_date range. VOIDED sessions are excluded; hours count CLOSED sessions only."""
    closed = AttendanceSession.status == "CLOSED"
    stmt = (
        select(
            Person.id, Person.external_code, Person.first_name, Person.last_name, Person.person_type,
            Person.group_name,
            func.coalesce(func.sum(AttendanceSession.duration_seconds).filter(closed), 0).label("seconds"),
            func.count(distinct(AttendanceSession.work_date)).label("days"),
            func.count().filter(closed).label("n_closed"),
            func.count().filter(AttendanceSession.status == "OPEN").label("n_open"),
        )
        .join(AttendanceSession, AttendanceSession.person_id == Person.id)
        .where(
            AttendanceSession.status != "VOIDED",
            AttendanceSession.work_date >= date_from,
            AttendanceSession.work_date <= date_to,
        )
        .group_by(Person.id)
        .order_by(Person.last_name, Person.first_name)
    )
    if person_type:
        stmt = stmt.where(Person.person_type == person_type.upper())
    late_counts = await _late_entries(db, date_from, date_to)
    tracked_types = set((await db.scalars(
        select(AttendanceRule.person_type).where(AttendanceRule.late_after_time.is_not(None))
    )).all())
    return [
        {
            "person_id": str(r.id), "external_code": r.external_code,
            "person_name": f"{r.first_name} {r.last_name}", "person_type": r.person_type,
            "group_name": r.group_name or "", "total_hours": round(int(r.seconds) / 3600, 2),
            "days_present": r.days,
            # None = lateness is not tracked for this type (no late_after_time set), as opposed to 0 late days
            "late_entries": late_counts.get(r.id, 0) if r.person_type in tracked_types else None,
            "sessions_closed": r.n_closed, "sessions_open": r.n_open,
        }
        for r in (await db.execute(stmt)).all()
    ]


async def _late_entries(db: AsyncSession, date_from: date, date_to: date) -> dict:
    """Days on which a person's first (non-voided) entry was after their type's late_after_time (school-local)."""
    first_entry = (
        select(
            AttendanceSession.person_id,
            AttendanceSession.work_date,
            func.min(AttendanceSession.entry_time).label("first_entry"),
        )
        .where(
            AttendanceSession.status != "VOIDED",
            AttendanceSession.work_date >= date_from,
            AttendanceSession.work_date <= date_to,
        )
        .group_by(AttendanceSession.person_id, AttendanceSession.work_date)
        .subquery()
    )
    stmt = (
        select(first_entry.c.person_id, func.count())
        .join(Person, Person.id == first_entry.c.person_id)
        .join(AttendanceRule, AttendanceRule.person_type == Person.person_type)
        .where(
            AttendanceRule.late_after_time.is_not(None),
            cast(func.timezone(settings.school_tz, first_entry.c.first_entry), Time) > AttendanceRule.late_after_time,
        )
        .group_by(first_entry.c.person_id)
    )
    return dict((await db.execute(stmt)).all())


def _safe(value):
    """Neutralise spreadsheet formula injection in exported text (=, +, -, @ at the start of a cell)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def to_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow([label for _, label in COLUMNS])
    for row in rows:
        writer.writerow([_safe(row[key]) for key, _ in COLUMNS])
    return buf.getvalue().encode("utf-8-sig")  # BOM so Excel reads UTF-8 names correctly


def to_xlsx(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance summary"
    ws.append([label for _, label in COLUMNS])
    for row in rows:
        ws.append([_safe(row[key]) for key, _ in COLUMNS])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
