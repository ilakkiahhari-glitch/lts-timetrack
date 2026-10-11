import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.schemas.users import UserCreate, UserOut, UserUpdate
from app.security import hash_password, require_role
from app.services.audit_service import add_audit

router = APIRouter(prefix="/api/v1/users", tags=["users"])

admin_only = require_role("ADMIN")


def _snapshot(user: User) -> dict:
    return {"email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@router.get("", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _: User = Depends(admin_only)):
    return (await db.scalars(select(User).order_by(User.created_at))).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_only)
):
    user = User(
        email=body.email,
        full_name=body.full_name,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use") from None
    add_audit(db, actor_id=admin.id, action="CREATE", entity_type="user", entity_id=user.id,
              new_values=_snapshot(user), request=request)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(admin_only),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id and (body.is_active is False or (body.role and body.role != "ADMIN")):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot deactivate or demote yourself")

    before = _snapshot(user)
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        user.failed_logins = 0
        user.locked_until = None
    add_audit(db, actor_id=admin.id, action="UPDATE", entity_type="user", entity_id=user.id,
              old_values=before, new_values={**_snapshot(user), "password_reset": body.password is not None},
              request=request)
    await db.commit()
    await db.refresh(user)
    return user
