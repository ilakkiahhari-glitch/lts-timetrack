"""Rules the database enforces on its own, and the nightly open-session job."""

import asyncio
from datetime import datetime, time, timedelta, timezone

import psycopg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.services import maintenance_service
from tests.conftest import TEST_URL

API = "/api/v1"


def test_events_and_audit_logs_are_append_only(client, admin, kiosk, make_person, pg):
    p = make_person()
    client.post(f"{API}/kiosk/scan", json={"qr_token": p["qr_token"]}, headers=kiosk)
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        pg.execute("UPDATE attendance_events SET event_type = 'EXIT' WHERE person_id = %s", (p["id"],))
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        pg.execute("DELETE FROM attendance_events WHERE person_id = %s", (p["id"],))
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        pg.execute("UPDATE audit_logs SET reason = 'tampered'")
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        pg.execute("DELETE FROM audit_logs")


def test_one_open_session_per_person_is_enforced_by_the_database(make_person, pg):
    p = make_person()
    insert = "INSERT INTO attendance_sessions (person_id, entry_time, work_date) VALUES (%s, now(), current_date)"
    pg.execute(insert, (p["id"],))
    with pytest.raises(psycopg.errors.UniqueViolation):
        pg.execute(insert, (p["id"],))


def test_session_check_constraints(make_person, pg):
    p = make_person()
    with pytest.raises(psycopg.errors.CheckViolation):  # exit must be after entry
        pg.execute("INSERT INTO attendance_sessions (person_id, entry_time, exit_time, status, work_date) "
                   "VALUES (%s, now(), now() - interval '1 hour', 'CLOSED', current_date)", (p["id"],))
    with pytest.raises(psycopg.errors.CheckViolation):  # CLOSED needs an exit time
        pg.execute("INSERT INTO attendance_sessions (person_id, entry_time, status, work_date) "
                   "VALUES (%s, now(), 'CLOSED', current_date)", (p["id"],))


# --- nightly job ---------------------------------------------------------------------------------

def test_cutoff_is_on_work_date_or_next_day_if_already_past():
    entry = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)
    same_day = maintenance_service.cutoff_for(entry, entry.date(), time(23, 59))
    assert same_day == datetime(2026, 3, 2, 23, 59, tzinfo=timezone.utc)  # SCHOOL_TZ defaults to UTC
    late_entry = datetime(2026, 3, 2, 23, 59, 30, tzinfo=timezone.utc)
    assert maintenance_service.cutoff_for(late_entry, late_entry.date(), time(23, 59)) > late_entry


def test_nightly_job_flags_but_never_closes(client, admin, kiosk, make_person, instant_type, pg):
    # a rule with a cutoff for this type; sessions from "yesterday" are stale, a person with no cutoff is not
    assert client.put(f"{API}/attendance-rules/{instant_type}",
                      json={"duplicate_window_seconds": 0, "auto_close_time": "23:59:00"}, headers=admin).status_code == 200
    stale, fresh = make_person(person_type=instant_type), make_person(person_type=instant_type)
    for p in (stale, fresh):
        assert client.post(f"{API}/kiosk/scan", json={"qr_token": p["qr_token"]}, headers=kiosk).status_code == 200

    async def run(now):
        engine = create_async_engine(TEST_URL.replace("postgresql://", "postgresql+asyncpg://"), poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                return await maintenance_service.flag_stale_open_sessions(db, now=now)
        finally:
            await engine.dispose()

    assert asyncio.run(run(datetime.now(timezone.utc) - timedelta(days=2))) == 0  # before any cutoff: nothing
    flagged = asyncio.run(run(datetime.now(timezone.utc) + timedelta(days=2)))     # after the cutoff: everyone open
    assert flagged >= 2
    assert asyncio.run(run(datetime.now(timezone.utc) + timedelta(days=2))) == 0   # idempotent: no double flagging

    rows = client.get(f"{API}/attendance/sessions", params={"person_id": stale["id"]}, headers=admin).json()
    assert rows[0]["status"] == "OPEN"                                   # still open, not auto-closed
    assert rows[0]["notes"].startswith(maintenance_service.FLAG_PREFIX)  # flagged for review
    audit = client.get(f"{API}/audit-logs", params={"entity_type": "attendance_session", "entity_id": rows[0]["id"]},
                       headers=admin).json()
    assert audit[0]["new_values"] == {"flag": "STALE_OPEN"} and audit[0]["actor_id"] is None


def test_types_without_auto_close_time_are_never_flagged(client, admin, kiosk, make_person, instant_type):
    p = make_person(person_type=instant_type)  # instant_type has auto_close_time = NULL
    client.post(f"{API}/kiosk/scan", json={"qr_token": p["qr_token"]}, headers=kiosk)

    async def run():
        engine = create_async_engine(TEST_URL.replace("postgresql://", "postgresql+asyncpg://"), poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                await maintenance_service.flag_stale_open_sessions(db, now=datetime.now(timezone.utc) + timedelta(days=30))
        finally:
            await engine.dispose()

    asyncio.run(run())
    rows = client.get(f"{API}/attendance/sessions", params={"person_id": p["id"]}, headers=admin).json()
    assert rows[0]["notes"] is None


def test_cors_is_restricted(client):
    allowed = client.options(f"{API}/users", headers={
        "Origin": settings.allowed_origins[0], "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization"})
    assert allowed.status_code == 200
    assert client.options(f"{API}/users", headers={
        "Origin": "http://evil.example", "Access-Control-Request-Method": "GET"}).status_code == 400
    assert client.options(f"{API}/users", headers={
        "Origin": settings.allowed_origins[0], "Access-Control-Request-Method": "DELETE"}).status_code == 400
