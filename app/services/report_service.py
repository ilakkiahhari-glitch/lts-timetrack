"""Reporting Service: aggregate sessions by person, type and date range; CSV/XLSX export."""

import csv
import io
from datetime import date

from openpyxl import Workbook
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AttendanceSession, Person

COLUMNS = [
    ("external_code", "Code"), ("person_name", "Name"), ("person_type", "Type"), ("group_name", "Group"),
    ("total_hours", "Total hours"), ("days_present", "Days present"),
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
    return [
        {
            "person_id": str(r.id), "external_code": r.external_code,
            "person_name": f"{r.first_name} {r.last_name}", "person_type": r.person_type,
            "group_name": r.group_name or "", "total_hours": round(int(r.seconds) / 3600, 2),
            "days_present": r.days, "sessions_closed": r.n_closed, "sessions_open": r.n_open,
        }
        for r in (await db.execute(stmt)).all()
    ]


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
