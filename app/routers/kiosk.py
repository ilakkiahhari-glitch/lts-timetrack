from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Device, User
from app.ratelimit import scan_limiter
from app.schemas.kiosk import OnSiteEntry, ScanRequest, ScanResponse
from app.security import require_device, require_role
from app.services import attendance_service, qr_service

router = APIRouter(prefix="/api/v1/kiosk", tags=["kiosk"])

operator_roles = require_role("VOLUNTEER", "ADMIN")


@router.post("/scan", response_model=ScanResponse, dependencies=[Depends(scan_limiter)])
async def scan(
    body: ScanRequest,
    db: AsyncSession = Depends(get_db),
    device: Device = Depends(require_device),
    operator: User = Depends(operator_roles),
):
    person = await qr_service.validate_qr(db, body.qr_token.strip())
    if person is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid QR code")
    return await attendance_service.process_scan(db, person, device.id, operator.id)


@router.get("/status", response_model=list[OnSiteEntry])
async def status_on_site(
    db: AsyncSession = Depends(get_db),
    _device: Device = Depends(require_device),
    _operator: User = Depends(operator_roles),
):
    """Who is on site right now (short names only)."""
    return await attendance_service.on_site(db)
