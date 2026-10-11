"""Fixed-window-per-key rate limiting (design section 7: 30 req/min per device or IP).

In-memory, so each uvicorn worker counts separately; put the limit at Nginx too if you need an exact global cap.
"""

import hashlib
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import settings

WINDOW_SECONDS = 60


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
        now = time.monotonic()
        key = self._key(request)
        hits = self._hits[key]
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= settings.rate_limit_per_minute:
            retry_after = max(1, int(WINDOW_SECONDS - (now - hits[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


login_limiter = RateLimiter("login")
scan_limiter = RateLimiter("scan", by_device=True)
