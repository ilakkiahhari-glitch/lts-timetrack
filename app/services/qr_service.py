"""QR Validation: map a scanned token to an active person."""

import base64
import hashlib
import io
import logging
import secrets
import time
import uuid

import segno
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Person
from app.redis_client import get_redis

log = logging.getLogger(__name__)


def new_qr_token() -> str:
    """Random 256-bit token printed in the QR code. Shown once; only its hash is stored."""
    return "tt_" + secrets.token_urlsafe(32)


def qr_png_bytes(raw_token: str) -> bytes:
    buf = io.BytesIO()
    segno.make(raw_token, error="m").save(buf, kind="png", scale=8, border=2)
    return buf.getvalue()


def qr_png_data_uri(raw_token: str) -> str:
    return "data:image/png;base64," + base64.b64encode(qr_png_bytes(raw_token)).decode()


# Raw tokens are never stored in the database. To serve GET /people/{id}/qr ("printable image for a freshly
# issued token"), the token is held for a short time after it is issued (QR_IMAGE_TTL_SECONDS), then forgotten.
# Held in Redis when REDIS_URL is set, so any worker can serve it; otherwise (or if Redis is down) in this
# process's memory, where another worker would answer 404.
_fresh_tokens: dict[uuid.UUID, tuple[str, float]] = {}


def _redis_key(person_id: uuid.UUID) -> str:
    return f"qr:fresh:{person_id}"


async def remember_fresh_token(person_id: uuid.UUID, raw_token: str) -> None:
    redis = get_redis()
    if redis is not None:
        try:
            await redis.set(_redis_key(person_id), raw_token, ex=settings.qr_image_ttl_seconds)
            return
        except Exception:  # noqa: BLE001  fall back to this process's memory
            log.warning("Redis unavailable; keeping the fresh QR token in memory", exc_info=True)
    now = time.monotonic()
    for pid in [pid for pid, (_, exp) in _fresh_tokens.items() if exp <= now]:
        del _fresh_tokens[pid]
    _fresh_tokens[person_id] = (raw_token, now + settings.qr_image_ttl_seconds)


async def recall_fresh_token(person_id: uuid.UUID) -> str | None:
    redis = get_redis()
    if redis is not None:
        try:
            token = await redis.get(_redis_key(person_id))
            if token:
                return token
        except Exception:  # noqa: BLE001
            log.warning("Redis unavailable; checking in-memory QR tokens only", exc_info=True)
    entry = _fresh_tokens.get(person_id)
    if entry is None or entry[1] <= time.monotonic():
        _fresh_tokens.pop(person_id, None)
        return None
    return entry[0]


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def validate_qr(db: AsyncSession, raw_token: str) -> Person | None:
    stmt = select(Person).where(
        Person.qr_token_hash == hash_token(raw_token),
        Person.is_active.is_(True),
        Person.qr_revoked_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()
