from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.security import require_role
from app.services import report_service
from app.services.audit_service import add_audit

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])

admin_only = require_role("ADMIN")


def _check_range(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date_to is before date_from")


@router.get("/summary")
async def summary(
    date_from: date,
    date_to: date,
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only),
):
    """Hours per person over a work_date range; filter by person type."""
    _check_range(date_from, date_to)
    return await report_service.summary_rows(db, date_from, date_to, type)


@router.get("/export")
async def export(
    date_from: date,
    date_to: date,
    request: Request,
    format: Literal["csv", "xlsx"] = Query("csv"),
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    """Download the summary as CSV or XLSX. Every export is audited as EXPORT."""
    _check_range(date_from, date_to)
    rows = await report_service.summary_rows(db, date_from, date_to, type)
    add_audit(
        db, actor_id=admin.id, action="EXPORT", entity_type="report", entity_id="summary",
        new_values={"format": format, "date_from": str(date_from), "date_to": str(date_to),
                    "type": type, "rows": len(rows)},
        request=request,
    )
    await db.commit()

    if format == "csv":
        content, media = report_service.to_csv(rows), "text/csv; charset=utf-8"
    else:
        content = report_service.to_xlsx(rows)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"attendance_{date_from}_{date_to}.{format}"
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
