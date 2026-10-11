"""Create the first admin user (idempotent). Run: python -m scripts.seed"""

import asyncio

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, engine
from app.models import User
from app.security import hash_password


async def main() -> None:
    async with SessionLocal() as db:
        existing = await db.scalar(select(User).where(User.email == settings.admin_email))
        if existing:
            print(f"Admin {settings.admin_email} already exists - nothing to do.")
        else:
            db.add(
                User(
                    email=settings.admin_email,
                    password_hash=hash_password(settings.admin_password),
                    full_name=settings.admin_name,
                    role="ADMIN",
                )
            )
            await db.commit()
            print(f"Created admin {settings.admin_email}. Change the password after first login.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
