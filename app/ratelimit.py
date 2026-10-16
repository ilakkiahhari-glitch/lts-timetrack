"""Rate limiting (design section 7: 30 req/min per device or IP).

With Redis configured (REDIS_URL) the counters are shared by every uvicorn worker: one fixed one-minute window
per key. Without Redis, or if Redis is down, each worker counts in its own memory (sliding window). Failing open
on a Redis outage keeps kiosks and logins working; the in-memory limit still applies.
"""

import hashlib
import logging
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import settings
from app.redis_client import get_redis

log = logging.getLogger(__name__)

WINDOW_SECONDS = 60


def _too_many(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests",
        headers={"Retry-After": str(max(1, retry_after))},
    )


class RateLimiter:
    def __init__(self, name: str, by_device: bool = False):
        self.name = name
        self.by_device = by_device
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _key(self, request: Request) -> str:
        device_key = request.headers.get("x-device-key") if self.by_device else None
        if device_key:
            return "dev:" + hashlib.sha256(device_key.encode()).hexdigest()[:16]
        return "ip:" + (request.client.host if request.client else "unknown")

    async def __call__(self, request: Request) -> None:
        key = self._key(request)
        redis = get_redis()
        if redis is not None:
            try:
                await self._check_redis(redis, key)
                return
            except HTTPException:
                raise
            except Exception:  # noqa: BLE001  Redis unreachable: fail open to the per-process limit
                log.warning("Redis unavailable for rate limiting; using in-memory limit", exc_info=True)
        self._check_memory(key)

    async def _check_redis(self, redis, key: str) -> None:
        redis_key = f"rl:{self.name}:{key}"
        await redis.set(redis_key, 0, ex=WINDOW_SECONDS, nx=True)  # the key always has an expiry
        if await redis.incr(redis_key) > settings.rate_limit_per_minute:
            raise _too_many(await redis.ttl(redis_key))

    def _check_memory(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= settings.rate_limit_per_minute:
            raise _too_many(int(WINDOW_SECONDS - (now - hits[0])))
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


login_limiter = RateLimiter("login")
scan_limiter = RateLimiter("scan", by_device=True)
