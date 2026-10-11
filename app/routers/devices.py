import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Device, User
from app.schemas.devices import DeviceCreate, DeviceOut, DeviceUpdate, DeviceWithKey
from app.security import hash_device_key, new_device_key, require_role
from app.services.audit_service import add_audit

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])

admin_only = require_role("ADMIN")

NAME_TAKEN = HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A device with that name already exists")


@router.get("", response_model=list[DeviceOut])
async def list_devices(db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    return (await db.scalars(select(Device).order_by(Device.name))).all()


@router.post("", response_model=DeviceWithKey, status_code=status.HTTP_201_CREATED)
async def register_device(
    body: DeviceCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_only)
):
    key = new_device_key()
    device = Device(name=body.name, location=body.location, api_key_hash=hash_device_key(key),
                    registered_by=admin.id)
    db.add(device)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise NAME_TAKEN from None
    add_audit(db, actor_id=admin.id, action="CREATE", entity_type="device", entity_id=device.id,
              new_values={"name": device.name, "location": device.location}, request=request)
    await db.commit()
    await db.refresh(device)
    return DeviceWithKey(**DeviceOut.model_validate(device).model_dump(), api_key=key)


@router.patch("/{device_id}", response_model=DeviceWithKey | DeviceOut)
async def update_device(
    device_id: uuid.UUID,
    body: DeviceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    device = await db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    before = {"name": device.name, "location": device.location, "is_active": device.is_active}
    if body.name is not None:
        device.name = body.name
    if "location" in body.model_fields_set:
        device.location = body.location
    if body.is_active is not None:
        device.is_active = body.is_active
    key = None
    if body.rotate_key:
        key = new_device_key()
        device.api_key_hash = hash_device_key(key)

    try:
        add_audit(db, actor_id=admin.id, action="UPDATE", entity_type="device", entity_id=device.id,
                  old_values=before,
                  new_values={"name": device.name, "location": device.location,
                              "is_active": device.is_active, "key_rotated": key is not None},
                  request=request)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise NAME_TAKEN from None
    await db.refresh(device)
    out = DeviceOut.model_validate(device).model_dump()
    return DeviceWithKey(**out, api_key=key) if key else DeviceOut(**out)
