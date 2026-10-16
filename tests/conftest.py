"""Integration-test fixtures.

API tests run against a throw-away PostgreSQL database (`lts_timetrack_test`, same server as dev). It is
dropped and rebuilt from the Alembic migration once per test run. If PostgreSQL is not reachable, the
API tests are skipped; the pure unit tests (state engine, health) still run.
"""

import os
import uuid

TEST_DB = "lts_timetrack_test"
ADMIN_BASE = os.environ.get("TEST_PG_ADMIN_URL", "postgresql://postgres:dev@localhost:5432/postgres")
TEST_URL = ADMIN_BASE.rsplit("/", 1)[0] + "/" + TEST_DB

# Must be set before `app` is imported anywhere (settings and the engine read it at import time).
os.environ["DATABASE_URL"] = TEST_URL.replace("postgresql://", "postgresql+asyncpg://")
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["JWT_SECRET"] = "test-secret-" + "x" * 32

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ADMIN_EMAIL = "admin@test.local"
ADMIN_PASSWORD = "AdminPass123"
VOLUNTEER_EMAIL = "volunteer@test.local"
VOLUNTEER_PASSWORD = "VolunteerPass123"


def uid(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:10]


@pytest.fixture(scope="session")
def pg():
    """Sync connection to the test database (for direct SQL checks); rebuilds the database first."""
    try:
        admin = psycopg.connect(ADMIN_BASE, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:
        pytest.skip(f"PostgreSQL not reachable: {exc}")
    with admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB}"')

    command.upgrade(Config("alembic.ini"), "head")

    from app.security import hash_password

    conn = psycopg.connect(TEST_URL, autocommit=True)
    for email, password, name, role in (
        (ADMIN_EMAIL, ADMIN_PASSWORD, "Test Admin", "ADMIN"),
        (VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD, "Test Volunteer", "VOLUNTEER"),
    ):
        conn.execute(
            "INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, %s, %s, %s)",
            (email, hash_password(password), name, role),
        )
    yield conn
    conn.close()


@pytest.fixture(scope="session")
def client(pg):
    from app.main import app

    with TestClient(app, client=("127.0.0.1", 50000)) as c:  # one event loop for the whole run, so the async engine's pool is reused safely
        yield c


def _login(client, email, password) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client) -> dict:
    return _login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def volunteer(client) -> dict:
    return _login(client, VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD)


@pytest.fixture(scope="session")
def device_key(client, admin) -> str:
    r = client.post("/api/v1/devices", json={"name": uid("kiosk-")}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()["api_key"]


@pytest.fixture(scope="session")
def kiosk(volunteer, device_key) -> dict:
    """Headers for a kiosk request: volunteer login plus device key."""
    return {**volunteer, "X-Device-Key": device_key}


@pytest.fixture
def make_person(client, admin):
    def _make(person_type="TEACHER", **overrides):
        body = {"person_type": person_type, "external_code": uid("P"), "first_name": "Test", "last_name": "Person"}
        body.update(overrides)
        r = client.post("/api/v1/people", json=body, headers=admin)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture
def fake_redis():
    """An in-memory Redis standing in for the shared store (installed for one test, then removed)."""
    from fakeredis import FakeAsyncRedis

    from app import redis_client

    redis = FakeAsyncRedis(decode_responses=True)
    redis_client.set_client_for_tests(redis)
    yield redis
    redis_client.set_client_for_tests(None)


@pytest.fixture
def instant_type(client, admin):
    """A person type with a 0-second duplicate window, so ENTRY and EXIT can follow each other immediately."""
    code = uid("T").upper()
    assert client.post("/api/v1/person-types", json={"code": code, "display_name": code}, headers=admin).status_code == 201
    r = client.put(f"/api/v1/attendance-rules/{code}", json={"duplicate_window_seconds": 0}, headers=admin)
    assert r.status_code == 200, r.text
    return code
