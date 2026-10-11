import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.ratelimit import login_limiter
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse
from app.security import create_token, decode_token, hash_password, verify_password
from app.services.audit_service import add_audit
from app.config import settings

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
# Verified against when the email is unknown, so response time does not reveal which emails exist.
_DUMMY_HASH = hash_password("not-a-real-password")


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(login_limiter)])
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    now = datetime.now(timezone.utc)

    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None:
        verify_password(body.password, _DUMMY_HASH)
        add_audit(db, actor_id=None, action="LOGIN_FAILED", entity_type="user",
                  entity_id=body.email, request=request)
        await db.commit()
        raise invalid

    if user.locked_until and user.locked_until > now:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account temporarily locked")

    if not verify_password(body.password, user.password_hash) or not user.is_active:
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_logins = 0
        add_audit(db, actor_id=user.id, action="LOGIN_FAILED", entity_type="user",
                  entity_id=user.id, request=request)
        await db.commit()
        raise invalid

    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    add_audit(db, actor_id=user.id, action="LOGIN", entity_type="user", entity_id=user.id, request=request)
    await db.commit()

    return TokenResponse(
        access_token=create_token(str(user.id), user.role),
        refresh_token=create_token(
            str(user.id), user.role, minutes=settings.refresh_token_days * 24 * 60, kind="refresh"
        ),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    try:
        payload = decode_token(body.refresh_token)
    except jwt.PyJWTError:
        raise invalid from None
    if payload.get("type") != "refresh":
        raise invalid
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise invalid
    return TokenResponse(access_token=create_token(str(user.id), user.role))
