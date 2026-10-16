"""Shared store for rate limits and fresh QR tokens (design G-3, G-4), so every uvicorn worker sees the same state.

Optional: with REDIS_URL unset, callers fall back to per-process memory (fine for one worker and for local dev).
Redis is only used for short-lived data with an expiry; nothing durable lives there.
"""

import logging

from redis.asyncio import Redis

from app.config import settings

log = logging.getLogger(__name__)

_client: Redis | None = None
_override: Redis | None = None  # set by tests


def get_redis() -> Redis | None:
    """The shared Redis client, or None when Redis is not configured."""
    global _client
    if _override is not None:
        return _override
    if _client is None and settings.redis_url:
        _client = Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=1, socket_connect_timeout=1)
    return _client


def set_client_for_tests(client: Redis | None) -> None:
    global _override
    _override = client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
