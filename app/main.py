from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.routers import attendance, audit, auth, devices, kiosk, people, person_types, reports, users

app = FastAPI(title="LTS TimeTrack", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Device-Key"],
)


@app.get("/api/v1/health", tags=["health"])
async def health() -> dict:
    """Liveness: the process is up."""
    return {"status": "ok"}


@app.get("/api/v1/health/db", tags=["health"])
async def health_db(db: AsyncSession = Depends(get_db)) -> dict:
    """Readiness: the database answers."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "db": "ok"}


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(people.router)
app.include_router(person_types.router)
app.include_router(devices.router)
app.include_router(kiosk.router)
app.include_router(attendance.router)
app.include_router(reports.router)
app.include_router(audit.router)
