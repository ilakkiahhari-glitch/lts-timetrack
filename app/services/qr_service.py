"""QR Validation: map a scanned token to an active person."""

import base64
import hashlib
import io
import secrets
import time
import uuid

import segno
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Person


def new_qr_token() -> str:
    """Random 256-bit token printed in the QR code. Shown once; only its hash is stored."""
    return "tt_" + secrets.token_urlsafe(32)


def qr_png_bytes(raw_token: str) -> bytes:
    buf = io.BytesIO()
    segno.make(raw_token, error="m").save(buf, kind="png", scale=8, border=2)
    return buf.getvalue()


def qr_png_data_uri(raw_token: str) -> str:
    return "data:image/png;base64," + base64.b64encode(qr_png_bytes(raw_token)).decode()


# Raw tokens are never stored. To serve GET /people/{id}/qr ("printable image for a freshly issued
# token"), the token is held in memory for a short time after it is issued, then forgotten.
# Per-process: with several workers a request may land on a worker that never saw the token (404).
_fresh_tokens: dict[uuid.UUID, tuple[str, float]] = {}


def remember_fresh_token(person_id: uuid.UUID, raw_token: str) -> None:
    now = time.monotonic()
    for pid in [pid for pid, (_, exp) in _fresh_tokens.items() if exp <= now]:
        del _fresh_tokens[pid]
    _fresh_tokens[person_id] = (raw_token, now + settings.qr_image_ttl_seconds)


def recall_fresh_token(person_id: uuid.UUID) -> str | None:
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
