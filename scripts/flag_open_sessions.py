"""Nightly job: flag sessions left open past their auto-close time. Run: python -m scripts.flag_open_sessions

Schedule it nightly (Windows Task Scheduler, cron, or a scheduled container).
"""

import asyncio

from app.db import SessionLocal, engine
from app.services.maintenance_service import flag_stale_open_sessions


async def main() -> None:
    async with SessionLocal() as db:
        count = await flag_stale_open_sessions(db)
    print(f"Flagged {count} open session(s) for admin review.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
