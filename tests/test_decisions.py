"""Behaviour for the decided open items: stale sessions (OI-1), nightly flag-only (OI-3), late entries (OI-2),
and the shared Redis store for rate limits and fresh QR tokens (G-3, G-4)."""

from datetime import datetime, time, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import redis_client
from app.config import settings
from app.ratelimit import RateLimiter
from app.services import qr_service
from app.services.session_flags import is_stale, stale_cutoff

API = "/api/v1"


def scan(client, kiosk, person):
    return client.post(f"{API}/kiosk/scan", json={"qr_token": person["qr_token"]}, headers=kiosk).json()


def sessions_of(client, admin, person, **params):
    return client.get(f"{API}/attendance/sessions", params={"person_id": person["id"], **params}, headers=admin).json()


# --- OI-1: scan after a stale open session -------------------------------------------------------

def test_stale_cutoff_logic():
    entry = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)  # SCHOOL_TZ defaults to UTC
    day = entry.date()
    # no auto_close_time: stale from the end of the work date
    assert stale_cutoff(entry, day, None) == datetime(2026, 3, 3, 0, 0, tzinfo=timezone.utc)
    assert not is_stale(entry, day, None, datetime(2026, 3, 2, 23, 59, tzinfo=timezone.utc))
    assert is_stale(entry, day, None, datetime(2026, 3, 3, 0, 0, tzinfo=timezone.utc))
    # with a cutoff: stale from that time on the work date
    assert not is_stale(entry, day, time(17, 0), datetime(2026, 3, 2, 16, 59, tzinfo=timezone.utc))
    assert is_stale(entry, day, time(17, 0), datetime(2026, 3, 2, 17, 0, tzinfo=timezone.utc))


def test_scan_after_stale_session_voids_it_and_starts_a_new_entry(client, admin, kiosk, make_person, instant_type, pg):
    p = make_person(person_type=instant_type)
    assert scan(client, kiosk, p)["result"] == "ENTRY"
    stale = sessions_of(client, admin, p)[0]
    # make that session look like it was left open yesterday
    pg.execute("UPDATE attendance_sessions SET work_date = current_date - 1, "
               "entry_time = entry_time - interval '1 day' WHERE id = %s", (stale["id"],))

    result = scan(client, kiosk, p)
    assert result["result"] == "ENTRY" and "missed" in result["message"].lower()

    old = client.get(f"{API}/attendance/sessions/{stale['id']}", headers=admin).json()
    assert old["status"] == "VOIDED" and old["notes"].startswith("[MISSED EXIT]")
    assert [s["status"] for s in sessions_of(client, admin, p, status="OPEN")] == ["OPEN"]  # exactly one open

    audit = client.get(f"{API}/audit-logs", params={"entity_type": "attendance_session", "entity_id": stale["id"]},
                       headers=admin).json()
    assert audit[0]["new_values"] == {"status": "VOIDED", "flag": "MISSED_EXIT"}
    assert audit[0]["actor_id"] and "Missed exit" in audit[0]["reason"]

    # the person's next scan is a normal EXIT of the new session
    assert scan(client, kiosk, p)["result"] == "EXIT"


def test_missed_exit_session_can_be_rebuilt_once(client, admin, kiosk, make_person, instant_type, pg):
    p = make_person(person_type=instant_type)
    scan(client, kiosk, p)
    stale = sessions_of(client, admin, p)[0]
    pg.execute("UPDATE attendance_sessions SET work_date = current_date - 1 WHERE id = %s", (stale["id"],))
    assert scan(client, kiosk, p)["result"] == "ENTRY"  # voids the stale one

    fix = {"entry_time": "2026-03-02T08:00:00Z", "exit_time": "2026-03-02T16:00:00Z", "reason": "Forgot to scan out"}
    url = f"{API}/attendance/sessions/{stale['id']}/correct"
    rebuilt = client.post(url, json=fix, headers=admin)
    assert rebuilt.status_code == 201 and rebuilt.json()["duration_seconds"] == 8 * 3600
    assert "[CORRECTED]" in client.get(f"{API}/attendance/sessions/{stale['id']}", headers=admin).json()["notes"]
    assert client.post(url, json=fix, headers=admin).status_code == 409  # not twice: no double counting


def test_fresh_open_session_is_still_a_normal_exit(client, kiosk, make_person, instant_type):
    p = make_person(person_type=instant_type)
    assert [scan(client, kiosk, p)["result"] for _ in range(2)] == ["ENTRY", "EXIT"]


# --- OI-2: late entries --------------------------------------------------------------------------

def _closed_session(client, admin, kiosk, person, entry, exit_):
    assert scan(client, kiosk, person)["result"] == "ENTRY"
    sid = sessions_of(client, admin, person, status="OPEN")[0]["id"]
    r = client.post(f"{API}/attendance/sessions/{sid}/correct",
                    json={"entry_time": entry, "exit_time": exit_, "reason": "test"}, headers=admin)
    assert r.status_code == 201


def test_late_after_time_rule_roundtrip(client, admin, instant_type):
    r = client.put(f"{API}/attendance-rules/{instant_type}", headers=admin,
                   json={"duplicate_window_seconds": 0, "late_after_time": "08:30:00"})
    assert r.status_code == 200 and r.json()["late_after_time"] == "08:30:00"
    assert client.get(f"{API}/attendance-rules/{instant_type}", headers=admin).json()["late_after_time"] == "08:30:00"


def test_late_entries_in_report(client, admin, kiosk, make_person, instant_type):
    client.put(f"{API}/attendance-rules/{instant_type}", headers=admin,
               json={"duplicate_window_seconds": 0, "late_after_time": "08:30:00"})
    p = make_person(person_type=instant_type)
    _closed_session(client, admin, kiosk, p, "2026-03-02T09:15:00Z", "2026-03-02T17:00:00Z")  # late
    _closed_session(client, admin, kiosk, p, "2026-03-03T08:00:00Z", "2026-03-03T16:00:00Z")  # on time
    # two entries the same day: only the first counts, and 08:30 exactly is not late
    _closed_session(client, admin, kiosk, p, "2026-03-04T08:30:00Z", "2026-03-04T12:00:00Z")
    _closed_session(client, admin, kiosk, p, "2026-03-04T13:00:00Z", "2026-03-04T17:00:00Z")

    params = {"date_from": "2026-03-01", "date_to": "2026-03-31", "type": instant_type}
    rows = client.get(f"{API}/reports/summary", params=params, headers=admin).json()
    assert rows[0]["days_present"] == 3 and rows[0]["late_entries"] == 1

    csv_lines = client.get(f"{API}/reports/export", params={**params, "format": "csv"}, headers=admin) \
        .content.decode("utf-8-sig").splitlines()
    assert csv_lines[1].split(",")[6] == "1"


def test_late_entries_blank_when_not_tracked(client, admin, kiosk, make_person, instant_type):
    p = make_person(person_type=instant_type)  # no late_after_time set for this type
    _closed_session(client, admin, kiosk, p, "2026-03-02T09:15:00Z", "2026-03-02T10:00:00Z")
    params = {"date_from": "2026-03-01", "date_to": "2026-03-31", "type": instant_type}
    assert client.get(f"{API}/reports/summary", params=params, headers=admin).json()[0]["late_entries"] is None
    csv_lines = client.get(f"{API}/reports/export", params={**params, "format": "csv"}, headers=admin) \
        .content.decode("utf-8-sig").splitlines()
    assert csv_lines[1].split(",")[6] == ""


# --- OI-3: the nightly job flags, never closes (covered in test_db_rules_and_jobs.py) -------------


# --- G-3 / G-4: shared Redis store ---------------------------------------------------------------

def _request(ip="203.0.113.7", device_key=None):
    headers = {"x-device-key": device_key} if device_key else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=ip))


async def test_rate_limit_is_shared_across_workers(fake_redis, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    worker_a, worker_b = RateLimiter("shared-test"), RateLimiter("shared-test")  # two workers, separate memory
    await worker_a(_request())
    await worker_b(_request())
    await worker_a(_request())
    with pytest.raises(HTTPException) as exc:
        await worker_b(_request())  # 4th hit overall, though each worker only saw 2
    assert exc.value.status_code == 429 and int(exc.value.headers["Retry-After"]) >= 1
    await worker_a(_request(ip="198.51.100.9"))  # another client is unaffected
    assert await fake_redis.ttl("rl:shared-test:ip:203.0.113.7") > 0  # the window always expires


async def test_without_redis_each_worker_counts_alone(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    worker_a, worker_b = RateLimiter("local-test"), RateLimiter("local-test")
    for limiter in (worker_a, worker_b, worker_a, worker_b):
        await limiter(_request())  # 4 hits in total, but only 2 per worker: nobody is blocked


class _BrokenRedis:
    async def _boom(self, *args, **kwargs):
        raise ConnectionError("redis is down")

    set = get = incr = ttl = _boom


async def test_rate_limit_fails_open_to_memory_when_redis_is_down(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    redis_client.set_client_for_tests(_BrokenRedis())
    try:
        limiter = RateLimiter("down-test")
        await limiter(_request())
        await limiter(_request())
        with pytest.raises(HTTPException) as exc:  # the per-process limit still applies
            await limiter(_request())
        assert exc.value.status_code == 429
    finally:
        redis_client.set_client_for_tests(None)


def test_fresh_qr_token_is_shared_through_redis(client, admin, make_person, fake_redis):
    p = make_person()
    qr_service._fresh_tokens.clear()  # another worker has no memory of it
    png = client.get(f"{API}/people/{p['id']}/qr", headers=admin)
    assert png.status_code == 200 and png.content.startswith(b"\x89PNG")

    import asyncio

    async def stored():
        return await fake_redis.get(f"qr:fresh:{p['id']}"), await fake_redis.ttl(f"qr:fresh:{p['id']}")

    token, ttl = asyncio.run(stored())
    assert token == p["qr_token"] and 0 < ttl <= settings.qr_image_ttl_seconds

    rotated = client.post(f"{API}/people/{p['id']}/qr/rotate", headers=admin).json()
    assert asyncio.run(stored())[0] == rotated["qr_token"]  # the old token is replaced, never served again


def test_fresh_qr_token_falls_back_to_memory_when_redis_is_down(client, admin, make_person):
    redis_client.set_client_for_tests(_BrokenRedis())
    try:
        p = make_person()  # creating must still work
        assert client.get(f"{API}/people/{p['id']}/qr", headers=admin).status_code == 200
    finally:
        redis_client.set_client_for_tests(None)
