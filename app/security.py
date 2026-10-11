import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import Device, User

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_token(subject: str, role: str, minutes: int | None = None, kind: str = "access") -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=minutes or settings.access_token_minutes)
    payload = {"sub": subject, "role": role, "type": kind, "exp": expires}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the logged-in user from an access token; 401 if missing, invalid or inactive."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None:
        raise unauthorized
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise unauthorized from None
    if payload.get("type") != "access":
        raise unauthorized
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise unauthorized
    return user


_device_key_header = APIKeyHeader(name="X-Device-Key", auto_error=False)


def new_device_key() -> str:
    """Random per-kiosk API key. Shown once; only its hash is stored."""
    return "dk_" + secrets.token_urlsafe(32)


def hash_device_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def require_device(
    key: str | None = Depends(_device_key_header),
    db: AsyncSession = Depends(get_db),
) -> Device:
    """Authenticate a kiosk by its X-Device-Key header (401 if missing, unknown or deactivated)."""
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Device key required")
    device = await db.scalar(select(Device).where(Device.api_key_hash == hash_device_key(key)))
    if device is None or not device.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device key")
    device.last_seen_at = datetime.now(timezone.utc)
    await db.commit()  # persist last_seen even if the scan itself is rejected
    return device


def require_role(*roles: str):
    """Dependency factory: allow only users whose role is in `roles` (403 otherwise)."""

    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return checker
