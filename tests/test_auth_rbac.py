import uuid

import pytest

from app import ratelimit
from app.config import settings
from tests.conftest import ADMIN_EMAIL, VOLUNTEER_EMAIL, uid

API = "/api/v1"
SOME_ID = str(uuid.uuid4())

# Every admin-only endpoint in the API table (design section 6): (method, path, body)
ADMIN_ONLY = [
    ("GET", "/people", None),
    ("POST", "/people", {"person_type": "TEACHER", "external_code": "x", "first_name": "a", "last_name": "b"}),
    ("GET", f"/people/{SOME_ID}", None),
    ("PATCH", f"/people/{SOME_ID}", {"first_name": "x"}),
    ("POST", f"/people/{SOME_ID}/qr/rotate", None),
    ("GET", f"/people/{SOME_ID}/qr", None),
    ("GET", "/person-types", None),
    ("POST", "/person-types", {"code": "ZZ", "display_name": "x"}),
    ("GET", "/attendance-rules/TEACHER", None),
    ("PUT", "/attendance-rules/TEACHER", {"duplicate_window_seconds": 30}),
    ("GET", "/attendance/sessions", None),
    ("GET", f"/attendance/sessions/{SOME_ID}", None),
    ("POST", f"/attendance/sessions/{SOME_ID}/correct",
     {"entry_time": "2026-01-01T08:00:00Z", "exit_time": "2026-01-01T09:00:00Z", "reason": "x"}),
    ("GET", "/reports/summary?date_from=2026-01-01&date_to=2026-01-31", None),
    ("GET", "/reports/export?date_from=2026-01-01&date_to=2026-01-31&format=csv", None),
    ("GET", "/devices", None),
    ("POST", "/devices", {"name": "x"}),
    ("PATCH", f"/devices/{SOME_ID}", {"name": "x"}),
    ("GET", "/users", None),
    ("POST", "/users", {"email": "a@b.co", "full_name": "x", "role": "VOLUNTEER", "password": "password123"}),
    ("PATCH", f"/users/{SOME_ID}", {"full_name": "x"}),
    ("GET", "/audit-logs", None),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY, ids=[f"{m} {p.split('?')[0]}" for m, p, _ in ADMIN_ONLY])
def test_admin_only_rbac(client, volunteer, method, path, body):
    assert client.request(method, API + path, json=body).status_code == 401
    assert client.request(method, API + path, json=body, headers=volunteer).status_code == 403


@pytest.mark.parametrize("method,path", [("POST", "/kiosk/scan"), ("GET", "/kiosk/status")])
def test_kiosk_needs_device_key_and_login(client, volunteer, device_key, method, path):
    body = {"qr_token": "tt_x"} if method == "POST" else None
    assert client.request(method, API + path, json=body, headers=volunteer).status_code == 401  # no device key
    assert client.request(method, API + path, json=body, headers={"X-Device-Key": device_key}).status_code == 401
    bad = {**volunteer, "X-Device-Key": "dk_wrong"}
    assert client.request(method, API + path, json=body, headers=bad).status_code == 401


def test_login_and_refresh(client):
    ok = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "AdminPass123"})
    assert ok.status_code == 200
    tokens = ok.json()
    assert tokens["access_token"] and tokens["refresh_token"]

    assert client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 200
    # an access token is not a refresh token, and vice versa
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401
    as_access = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    assert client.get(f"{API}/users", headers=as_access).status_code == 401

    assert client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "nope"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": "ghost@test.local", "password": "x"}).status_code == 401


def test_lockout_after_five_failed_logins(client, admin):
    email = f"{uid('lock')}@example.com"
    r = client.post(f"{API}/users", headers=admin,
                    json={"email": email, "full_name": "Lock Me", "role": "VOLUNTEER", "password": "Password123"})
    assert r.status_code == 201
    for _ in range(5):
        assert client.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
    locked = client.post(f"{API}/auth/login", json={"email": email, "password": "Password123"})
    assert locked.status_code == 403


def test_user_management(client, admin):
    email = f"{uid('u')}@example.com"
    body = {"email": email, "full_name": "New Vol", "role": "VOLUNTEER", "password": "Password123"}
    created = client.post(f"{API}/users", json=body, headers=admin)
    assert created.status_code == 201
    assert "password_hash" not in created.json()
    assert client.post(f"{API}/users", json=body, headers=admin).status_code == 409
    assert client.post(f"{API}/users", json={**body, "email": "x@y.co", "password": "short"}, headers=admin).status_code == 422

    uid_ = created.json()["id"]
    assert client.patch(f"{API}/users/{uid_}", json={"is_active": False}, headers=admin).json()["is_active"] is False
    assert client.post(f"{API}/auth/login", json={"email": email, "password": "Password123"}).status_code == 401

    me = next(u for u in client.get(f"{API}/users", headers=admin).json() if u["email"] == ADMIN_EMAIL)
    assert client.patch(f"{API}/users/{me['id']}", json={"role": "VOLUNTEER"}, headers=admin).status_code == 409
    assert client.patch(f"{API}/users/{me['id']}", json={"is_active": False}, headers=admin).status_code == 409


def test_rate_limit_on_login_and_scan(client, kiosk, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    for limiter in (ratelimit.login_limiter, ratelimit.scan_limiter):
        limiter.reset()
    try:
        codes = [client.post(f"{API}/auth/login", json={"email": VOLUNTEER_EMAIL, "password": "bad"}).status_code
                 for _ in range(5)]
        assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]

        codes = [client.post(f"{API}/kiosk/scan", json={"qr_token": "tt_unknown"}, headers=kiosk).status_code
                 for _ in range(5)]
        assert codes[:3] == [422, 422, 422] and codes[3:] == [429, 429]
    finally:
        for limiter in (ratelimit.login_limiter, ratelimit.scan_limiter):
            limiter.reset()
