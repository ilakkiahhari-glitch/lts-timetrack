# LTS TimeTrack – Detailed Design Document

Oct 7, 2026 · @Harikrishnan Venkataraman

## 1. Overview

LTS TimeTrack records the on-site time of registered people (teachers today; students, staff or visitors later) by QR scan at a kiosk: the first scan opens an attendance session (ENTRY), the next closes it (EXIT). The backend is Python (FastAPI) on PostgreSQL.

**Goals**

- Accurate, tamper-evident attendance for any registered person type with entry/exit events.
- Fast kiosk scans (target p95 < 300 ms) with duplicate-scan protection (30 s window).
- Admin dashboard, people management, reports and CSV/XLSX export.
- Full audit trail for every correction.

**Roles**

| Role | Created by | Uses | Permissions |
| --- | --- | --- | --- |
| Administrator | Another admin (first admin seeded at install) | Admin Dashboard, Reports & Export, People Management | Everything: create and manage volunteers, admins, people, devices and attendance rules; see all attendance data; corrections; reports; audit logs |
| Volunteer Scanner Operator | An administrator (no self-signup) | Kiosk / QR Scanner | Log in, scan people's QR codes, see who is on site; no reports or personal data beyond the scan result |

**Assumptions**

- A **person** is anyone who can be scanned. Each has a `person_type` (TEACHER, STUDENT, STAFF, VISITOR; extensible) and one active QR token (opaque, rotatable); the QR never contains personal data.
- Logins (`users`) are only for admins and volunteers and are created by admins (no self-signup); people never log in.
- Type-specific rules (duplicate window, auto-close cutoff) live in an `attendance_rules` table keyed by person type, so they are configuration, not code.
- Kiosks are registered devices authenticating with a device key.
- All timestamps are stored in UTC (`timestamptz`) and displayed in the school's local timezone.
- One open session per person at any time.
- Out of scope for now: payroll, biometric capture, native mobile apps, and read-only logins for people to view their own attendance. The last is a planned future feature; the design leaves room for it (add a nullable link from people to users, plus a read-only role limited to own records), with no change to the scan path.

## 2. Architecture

*[Embedded content: system architecture · 5 layers]*

Request path: Volunteers and admins use the LTS TimeTrack web app, which calls the FastAPI backend over REST. The backend's services (authentication, QR validation, attendance, audit, reports) read and write PostgreSQL through SQLAlchemy. The kiosk screen and admin screens share the same API, so one set of business rules governs both.

**Design decisions**

- Thin routers, services hold rules, the state engine is pure logic with no I/O.
- One transaction per scan with a row lock on the person, so two simultaneous scans cannot create two sessions.
- Integrity rules live in PostgreSQL (partial unique index, check constraints, append-only triggers), not only in Python.

## 3. Scan Workflow

*[Embedded content: kiosk scan flow · 3 decisions, 4 results]*

The state engine runs these checks in order. A duplicate within the person type's window (30 seconds by default) of that person's last event is ignored; otherwise an open session means this scan is the exit, and no open session means it is the entry. Every path ends by returning a result to the kiosk.

> **[DECIDED OI-1] Stale open sessions.** An open session is *stale* once it is past its person type's `auto_close_time` on its work date, or, if the type has no `auto_close_time`, once its work date has ended (local midnight). A scan by a person whose open session is stale is **not** treated as the EXIT: the stale session is set to VOIDED with a `[MISSED EXIT]` note and an audit row (the scan's operator is the actor), and the scan starts a new session (ENTRY, with the message "Previous exit was missed"). An admin can rebuild the voided session once with a correction (the old session is then marked `[CORRECTED]`). The duplicate check runs first, so a duplicate scan never voids anything.

| Check | Source | Outcome |
| --- | --- | --- |
| QR valid | people.qr_token_hash, is_active, qr_revoked_at | No: HTTP 422, nothing written |
| Duplicate in window | latest attendance_events row for the person; window from attendance_rules (default 30 s) | Yes: HTTP 200 with DUPLICATE, nothing written |
| Open session exists | attendance_sessions where status = OPEN | No: create session and ENTRY event. Yes: set exit time, EXIT event, close session. Yes but stale: void it as a missed exit, then create a new session and ENTRY event (OI-1, below) |

## 4. Python Backend Design

FastAPI with async SQLAlchemy 2.0 and asyncpg, Pydantic v2 for validation, Alembic for migrations. Routers stay thin; business rules live in services; the state engine is a pure function so it is trivially testable.

**Project structure**

```text
lts_timetrack/
├── app/
│   ├── main.py                 # FastAPI app, middleware, router registration
│   ├── config.py               # pydantic-settings (env vars)
│   ├── db.py                   # async engine + session dependency
│   ├── security.py             # JWT, argon2, device-key auth, RBAC deps
│   ├── models/                 # SQLAlchemy ORM (users, people, person types, devices, sessions, events, audit)
│   ├── schemas/                # Pydantic request/response models
│   ├── routers/
│   │   ├── auth.py
│   │   ├── kiosk.py            # POST /kiosk/scan
│   │   ├── people.py
│   │   ├── attendance.py
│   │   ├── reports.py
│   │   ├── devices.py
│   │   └── audit.py
│   └── services/
│       ├── qr_service.py       # QR Validation
│       ├── attendance_service.py
│       ├── state_engine.py     # Attendance State Engine
│       ├── audit_service.py    # Audit & Correction Service
│       └── report_service.py   # Reporting Service
├── alembic/                    # migrations (initial = schema in section 5)
├── tests/
├── pyproject.toml
└── Dockerfile
```

**Component responsibilities**

| Component | Responsibility |
| --- | --- |
| Authentication & Authorization | Login, JWT access/refresh tokens, role checks (ADMIN / VOLUNTEER), device API-key auth for kiosks |
| QR Validation | Hash the scanned token, look up an active, non-revoked person; reject otherwise |
| Attendance State Engine | Decide the action (ENTRY, EXIT, DUPLICATE) from current state and last event time |
| Attendance Service | Execute the decision transactionally: create/close sessions, write events |
| Audit & Correction Service | Record audit rows; apply admin corrections (void + replace) |
| Reporting Service | Aggregate sessions by person, type and date range; CSV/XLSX export |

**State engine** (pure logic, no I/O)

```python
# app/services/state_engine.py
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum

class Action(str, Enum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    DUPLICATE = "DUPLICATE"

@dataclass(frozen=True)
class Rules:                      # loaded from attendance_rules for the person's type
    duplicate_window: timedelta = timedelta(seconds=30)

@dataclass(frozen=True)
class PersonState:
    has_open_session: bool
    last_event_time: datetime | None

def decide(state: PersonState, now: datetime, rules: Rules) -> Action:
    if state.last_event_time and now - state.last_event_time < rules.duplicate_window:
        return Action.DUPLICATE
    return Action.EXIT if state.has_open_session else Action.ENTRY
```

**QR validation**

```python
# app/services/qr_service.py
import hashlib
from sqlalchemy import select
from app.models import Person

def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()

async def validate_qr(db, raw_token: str) -> Person | None:
    stmt = select(Person).where(
        Person.qr_token_hash == hash_token(raw_token),
        Person.is_active.is_(True),
        Person.qr_revoked_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()
```

**Attendance service** (single transaction; row lock prevents double scans racing)

```python
# app/services/attendance_service.py
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.models import AttendanceSession, AttendanceEvent, AttendanceRule, Person
from app.services.state_engine import decide, PersonState, Rules, Action
from app.config import settings

async def load_rules(db, person_type: str) -> Rules:
    row = await db.get(AttendanceRule, person_type)
    return Rules(duplicate_window=timedelta(seconds=row.duplicate_window_seconds)) if row else Rules()

async def process_scan(db, person: Person, device_id, operator_id) -> dict:
    now = datetime.now(timezone.utc)
    async with db.begin():
        # Serialize concurrent scans for the same person
        await db.execute(select(Person.id).where(Person.id == person.id).with_for_update())

        rules = await load_rules(db, person.person_type)
        open_session = (await db.execute(
            select(AttendanceSession).where(
                AttendanceSession.person_id == person.id,
                AttendanceSession.status == "OPEN"))).scalar_one_or_none()
        last_time = (await db.execute(
            select(AttendanceEvent.event_time)
            .where(AttendanceEvent.person_id == person.id)
            .order_by(AttendanceEvent.event_time.desc()).limit(1))).scalar_one_or_none()

        action = decide(PersonState(open_session is not None, last_time), now, rules)
        who = {"person": person.full_name, "person_type": person.person_type}

        if action is Action.DUPLICATE:
            return {"result": "DUPLICATE", "message": "Already recorded", **who}

        if action is Action.ENTRY:
            local_date = now.astimezone(ZoneInfo(settings.school_tz)).date()
            session = AttendanceSession(person_id=person.id, entry_time=now,
                                        entry_device_id=device_id, work_date=local_date)
            db.add(session); await db.flush()
            db.add(AttendanceEvent(session_id=session.id, person_id=person.id,
                                   event_type="ENTRY", event_time=now,
                                   device_id=device_id, operator_id=operator_id))
            return {"result": "ENTRY", "message": "Person currently on site", **who}

        # EXIT
        open_session.exit_time = now
        open_session.exit_device_id = device_id
        open_session.status = "CLOSED"
        db.add(AttendanceEvent(session_id=open_session.id, person_id=person.id,
                               event_type="EXIT", event_time=now,
                               device_id=device_id, operator_id=operator_id))
        return {"result": "EXIT", "message": "Person checked out", **who}
```

**Kiosk router**

```python
# app/routers/kiosk.py
from fastapi import APIRouter, Depends, HTTPException
from app.security import require_device, require_role
from app.services import qr_service, attendance_service
from app.schemas.kiosk import ScanRequest, ScanResponse

router = APIRouter(prefix="/api/v1/kiosk", tags=["kiosk"])

@router.post("/scan", response_model=ScanResponse)
async def scan(body: ScanRequest, db=Depends(get_db),
               device=Depends(require_device),
               operator=Depends(require_role("VOLUNTEER", "ADMIN"))):
    person = await qr_service.validate_qr(db, body.qr_token)
    if person is None:
        raise HTTPException(status_code=422, detail="Invalid QR code")   # -> Reject Scan
    return await attendance_service.process_scan(db, person, device.id, operator.id)
```

**Audit and correction**

```python
# app/services/audit_service.py
async def correct_session(db, admin, session_id, new_entry, new_exit, reason: str):
    if not reason.strip():
        raise ValueError("A reason is required for corrections")
    async with db.begin():
        old = await db.get(AttendanceSession, session_id, with_for_update=True)
        before = serialize(old)
        old.status = "VOIDED"
        await db.flush()
        replacement = AttendanceSession(person_id=old.person_id, entry_time=new_entry,
                                        exit_time=new_exit, status="CLOSED",
                                        work_date=local_date(new_entry))
        db.add(replacement); await db.flush()
        db.add_all([
            AttendanceEvent(session_id=replacement.id, person_id=old.person_id,
                            event_type="ENTRY", event_time=new_entry, source="ADMIN_CORRECTION"),
            AttendanceEvent(session_id=replacement.id, person_id=old.person_id,
                            event_type="EXIT", event_time=new_exit, source="ADMIN_CORRECTION"),
            AuditLog(actor_id=admin.id, action="CORRECT", entity_type="attendance_session",
                     entity_id=str(session_id), old_values=before,
                     new_values=serialize(replacement), reason=reason),
        ])
        return replacement
```

**Key libraries:** fastapi, uvicorn[standard], sqlalchemy[asyncio]>=2, asyncpg, alembic, pydantic>=2, pydantic-settings, argon2-cffi, python-jose (or PyJWT), openpyxl (XLSX export), segno (QR images), redis (shared store client), pytest, httpx, fakeredis (tests).

## 5. PostgreSQL Schema

Eight tables: users, person_types, attendance_rules, people, devices, attendance_sessions, attendance_events and audit_logs. A person is anyone who can be scanned (teacher, student, staff, visitor). Person types are rows, not an enum, so a new type needs an INSERT, not a migration. Rules enforced in the database: one open session per person (partial unique index), exit after entry, and append-only audit and event tables.

```sql
-- LTS TimeTrack schema (PostgreSQL 14+)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role        AS ENUM ('ADMIN', 'VOLUNTEER');
CREATE TYPE session_status   AS ENUM ('OPEN', 'CLOSED', 'VOIDED');
CREATE TYPE event_type       AS ENUM ('ENTRY', 'EXIT');
CREATE TYPE event_source     AS ENUM ('KIOSK', 'ADMIN_CORRECTION', 'SYSTEM');
CREATE TYPE audit_action     AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'CORRECT', 'LOGIN', 'LOGIN_FAILED', 'EXPORT', 'QR_ROTATE');

-- Shared trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- 1. USERS (logins: admins and volunteer operators, created by admins)
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          CITEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,                 -- argon2id
    full_name      TEXT NOT NULL,
    role           user_role NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    failed_logins  INT NOT NULL DEFAULT 0,
    locked_until   TIMESTAMPTZ,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. PERSON TYPES (extensible: add a row, no migration)
CREATE TABLE person_types (
    code          TEXT PRIMARY KEY,               -- 'TEACHER', 'STUDENT', ...
    display_name  TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO person_types (code, display_name) VALUES
    ('TEACHER', 'Teacher'), ('STUDENT', 'Student'),
    ('STAFF', 'Staff'), ('VISITOR', 'Visitor');

-- 3. ATTENDANCE RULES (per person type; configuration, not code)
CREATE TABLE attendance_rules (
    person_type              TEXT PRIMARY KEY REFERENCES person_types(code),
    duplicate_window_seconds INT  NOT NULL DEFAULT 30 CHECK (duplicate_window_seconds >= 0),
    auto_close_time          TIME,                -- local time; NULL = never auto-flag open sessions
    late_after_time          TIME,                -- local time; first ENTRY of a day after this is "late"; NULL = lateness not tracked (added in migration 0002)
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO attendance_rules (person_type) SELECT code FROM person_types;

-- 4. PEOPLE (anyone who can be scanned)
CREATE TABLE people (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- people never log in; no link to users
    person_type    TEXT NOT NULL REFERENCES person_types(code),
    external_code  TEXT NOT NULL,                 -- employee no., student no., badge no.
    first_name     TEXT NOT NULL,
    last_name      TEXT NOT NULL,
    email          CITEXT,
    group_name     TEXT,                          -- department, class or organisation
    attributes     JSONB NOT NULL DEFAULT '{}',   -- type-specific fields (grade, guardian, host...)
    qr_token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256 of the QR token, never the raw token
    qr_version     INT  NOT NULL DEFAULT 1,       -- bump on rotation
    qr_issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    qr_revoked_at  TIMESTAMPTZ,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (person_type, external_code)
);
CREATE INDEX idx_people_name ON people (last_name, first_name);
CREATE INDEX idx_people_type ON people (person_type) WHERE is_active;
CREATE TRIGGER trg_people_updated BEFORE UPDATE ON people
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. DEVICES (registered kiosks)
CREATE TABLE devices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL UNIQUE,
    location       TEXT,
    api_key_hash   TEXT NOT NULL UNIQUE,          -- hashed device key
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at   TIMESTAMPTZ,
    registered_by  UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. ATTENDANCE SESSIONS (one entry..exit pair)
CREATE TABLE attendance_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id        UUID NOT NULL REFERENCES people(id),
    entry_time       TIMESTAMPTZ NOT NULL,
    exit_time        TIMESTAMPTZ,
    status           session_status NOT NULL DEFAULT 'OPEN',
    entry_device_id  UUID REFERENCES devices(id),
    exit_device_id   UUID REFERENCES devices(id),
    duration_seconds INT GENERATED ALWAYS AS
        (CASE WHEN exit_time IS NOT NULL
              THEN EXTRACT(EPOCH FROM (exit_time - entry_time))::INT END) STORED,
    work_date        DATE NOT NULL,               -- local school date of entry (set by app)
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_exit_after_entry CHECK (exit_time IS NULL OR exit_time > entry_time),
    CONSTRAINT chk_status_exit CHECK (
        (status = 'OPEN'   AND exit_time IS NULL) OR
        (status = 'CLOSED' AND exit_time IS NOT NULL) OR
        (status = 'VOIDED'))
);
-- Only ONE open session per person (core business rule)
CREATE UNIQUE INDEX uq_one_open_session_per_person
    ON attendance_sessions (person_id) WHERE status = 'OPEN';
CREATE INDEX idx_sessions_person_date ON attendance_sessions (person_id, work_date DESC);
CREATE INDEX idx_sessions_work_date   ON attendance_sessions (work_date);
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON attendance_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. ATTENDANCE EVENTS (immutable scan log)
CREATE TABLE attendance_events (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES attendance_sessions(id),
    person_id    UUID NOT NULL REFERENCES people(id),
    event_type   event_type NOT NULL,
    event_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
    source       event_source NOT NULL DEFAULT 'KIOSK',
    device_id    UUID REFERENCES devices(id),
    operator_id  UUID REFERENCES users(id),       -- volunteer logged in at kiosk
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_person_time ON attendance_events (person_id, event_time DESC);
CREATE INDEX idx_events_session     ON attendance_events (session_id);
-- One ENTRY and one EXIT per session
CREATE UNIQUE INDEX uq_event_per_session_type ON attendance_events (session_id, event_type);

-- 8. AUDIT LOGS (append-only)
CREATE TABLE audit_logs (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id     UUID REFERENCES users(id),
    action       audit_action NOT NULL,
    entity_type  TEXT NOT NULL,                   -- 'attendance_session', 'person', ...
    entity_id    TEXT NOT NULL,
    old_values   JSONB,
    new_values   JSONB,
    reason       TEXT,                            -- mandatory for CORRECT (enforced in service)
    ip_address   INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor  ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_time   ON audit_logs (created_at DESC);

-- Append-only guard for events and audit logs
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_immutable  BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_events_immutable BEFORE UPDATE OR DELETE ON attendance_events
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Convenience view: who is on site right now (any person type)
CREATE VIEW v_people_on_site AS
SELECT p.id AS person_id, p.person_type, p.external_code, p.first_name, p.last_name,
       s.id AS session_id, s.entry_time
FROM attendance_sessions s
JOIN people p ON p.id = s.person_id
WHERE s.status = 'OPEN';
```

**Design notes**

- Corrections never edit events. An admin correction voids the faulty session (status VOIDED) and creates a replacement session with new events whose source is ADMIN_CORRECTION. Each correction writes an audit_logs row with before/after JSON and a mandatory reason.
- The duplicate check (window from attendance_rules) reads the latest `attendance_events` row per person (index `idx_events_person_time`).
- Type-specific fields (grade, guardian, host, department) go in people.attributes (JSONB). If a type later needs queried or constrained columns, add a profile table (for example student_profiles) keyed by person_id without touching the scan path.
- Rules differ per type through attendance_rules (duplicate window, auto-close time, late-after time). A new type is one INSERT into person_types plus one into attendance_rules.

## 6. REST API Specification

Base path `/api/v1`. JSON everywhere; timestamps are ISO-8601 UTC. Errors use `{"detail": "..."}` with standard status codes (401, 403, 404, 409, 422).

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | /auth/login | Public | Email + password; returns access and refresh JWT |
| POST | /auth/refresh | Public | Exchange refresh token |
| POST | /kiosk/scan | Volunteer + device key | Process a QR scan; returns ENTRY, EXIT, DUPLICATE; invalid QR returns 422 |
| GET | /kiosk/status | Volunteer + device key | People currently on site |
| GET | /people | Admin | List, search; filter by `type`, `group`, active |
| POST | /people | Admin | Create a person of a given type and issue QR token (shown once) |
| GET / PATCH | /people/{id} | Admin | View or update |
| POST | /people/{id}/qr/rotate | Admin | Revoke old QR, issue new token |
| GET | /people/{id}/qr | Admin | Printable QR image (PNG) for a freshly issued token (available for a short time after issue; see G-3) |
| GET / POST | /person-types | Admin | List and add person types |
| GET / PUT | /attendance-rules/{person_type} | Admin | View or change duplicate window, auto-close time and late-after time |
| GET | /attendance/sessions | Admin | Filter by person, type, date range, status |
| GET | /attendance/sessions/{id} | Admin | Session with its events |
| POST | /attendance/sessions/{id}/correct | Admin | Void and replace; body requires `reason` |
| GET | /reports/summary | Admin | Hours per person over a date range; filter by type |
| GET | /reports/export?format=csv\|xlsx | Admin | Download report; audited as EXPORT |
| GET / POST | /devices | Admin | List and register kiosk (key shown once) |
| PATCH | /devices/{id} | Admin | Rename, deactivate, rotate key |
| GET / POST / PATCH | /users | Admin | Create volunteers and admins, set role, reset password, deactivate |
| GET | /audit-logs | Admin | Filter by entity, actor, date |
| GET | /health | Public | Liveness and DB check |

**Scan request and responses**

```json
POST /api/v1/kiosk/scan
{ "qr_token": "tt_9f2c...e1" }

200 { "result": "ENTRY",     "person": "A. Rivera", "person_type": "TEACHER", "message": "Person currently on site", "time": "2026-10-07T13:02:11Z" }
200 { "result": "EXIT",      "person": "A. Rivera", "person_type": "TEACHER", "message": "Person checked out",        "time": "2026-10-07T20:31:40Z", "duration_seconds": 27329 }
200 { "result": "DUPLICATE", "person": "A. Rivera", "person_type": "TEACHER", "message": "Already recorded" }
422 { "detail": "Invalid QR code" }
```

**Correction request**

```json
POST /api/v1/attendance/sessions/{id}/correct
{ "entry_time": "2026-10-07T12:55:00Z", "exit_time": "2026-10-07T20:30:00Z", "reason": "Forgot to scan out" }
```

## 7. Security, Operations and Delivery

**Security**

- Passwords hashed with argon2id; JWT access tokens (15 min) plus refresh tokens (7 days); lockout after 5 failed logins.
- Kiosks authenticate with a per-device API key (stored hashed) in addition to the operator login.
- QR codes carry a random 256-bit token; only its SHA-256 hash is stored. Rotating a QR revokes the old one immediately.
- RBAC enforced by FastAPI dependencies; volunteers can only scan and see who is on site; only admins see reports and personal data.
- HTTPS only, strict CORS, rate limit on /kiosk/scan and /auth/login (for example 30 req/min per device or IP).
- Parameterized queries via SQLAlchemy; Pydantic validates all input.

**Audit and corrections**

Every admin write, login, export and QR rotation creates an append-only audit_logs row. Corrections require a reason, void the old session and create a replacement, so history is never lost.

**Reporting**

Reports aggregate attendance_sessions by person (filterable by type) and work_date: total hours, days present, late entries, sessions still open. Export streams CSV or XLSX. A nightly job finds sessions left open past a configurable cutoff (for example 23:59 local) and flags them for admin review; they stay OPEN and are not auto-closed silently.

> **[DECIDED OI-2] Late entries.** A person is late on a day when their first non-voided entry of that work date (school-local time) is after the `late_after_time` of their person type's rule. The "Late entries" column counts those days per person. It is blank for types with no `late_after_time` (lateness not tracked), which is different from 0. VOIDED sessions are ignored. *Overtime is still open (see Open questions).*
>
> **[DECIDED OI-3] Nightly job: flag only.** Sessions left open past `auto_close_time` stay OPEN. The job adds a `[FLAGGED: left open past auto-close time]` note and an audit row (no actor), once per session, and never closes anything. It runs as `python -m scripts.flag_open_sessions`, scheduled nightly (`scripts/schedule_nightly_job.ps1` registers a Windows Scheduled Task). An admin resolves each flagged session with a correction.

**Deployment**

| Component | Choice |
| --- | --- |
| Web server / reverse proxy | Nginx with TLS, serves the web app static files, proxies /api to FastAPI |
| FastAPI app | Docker container, `uvicorn` with 2-4 workers behind Nginx |
| Database | Managed PostgreSQL 14+ with daily backups and point-in-time recovery |
| Shared store | Redis 7 (optional, localhost only): shared rate-limit counters and the short-lived fresh-QR-token cache across the uvicorn workers. Holds only expiring data; without it each worker uses its own memory |
| Config | Environment variables: DATABASE_URL, JWT_SECRET, SCHOOL_TZ, ALLOWED_ORIGINS, REDIS_URL (optional) |
| Migrations | Alembic, run on deploy; first revision = the DDL in section 5 |

**Non-functional targets**

| Area | Target |
| --- | --- |
| Scan latency | p95 < 300 ms |
| Availability | 99.5% during school hours |
| Data retention | Attendance 7 years; audit logs 7 years |
| Concurrency | Row lock per person plus partial unique index prevents double sessions |
| Time | UTC in storage; school timezone for work_date and display |

**Testing**

- Unit: state engine (ENTRY, EXIT, duplicate at 29 s and 31 s, different windows per person type), QR validation.
- Integration (pytest + a Postgres test container): full scan flow, concurrent scans, correction and audit row, immutability triggers.
- API: RBAC matrix per endpoint; invalid QR returns 422.

**Delivery roadmap**

1. Schema, migrations, auth, people, person-type and device management.
2. Kiosk scan flow, state engine, duplicate protection.
3. Admin dashboard, session list, corrections, audit log viewer.
4. Reports and export; open-session nightly job.
5. Hardening: rate limits, backups, monitoring, load test. Later (not in scope now): read-only self-service login for people.

**Open questions**

| ID | Question | Status | Current behaviour |
| --- | --- | --- | --- |
| OI-1 | Should a person scanned after the cutoff with a stale open session auto-start a new session? | **DECIDED** (2026-10-16) | Yes: the stale session is voided as a missed exit and the scan starts a new ENTRY. See Scan Workflow. |
| OI-2 | Required report columns (overtime, lateness thresholds)? | **PARTLY DECIDED** (2026-10-16) | Late entries: decided and built (per-type `late_after_time`, off until set). **Overtime: still OPEN**, no overtime column yet. |
| OI-3 | Nightly job: close stale sessions, or only flag them? | **DECIDED** (2026-10-16) | Flag only; sessions stay OPEN for admin review. See Reporting. |
| OI-4 | Is a printed QR badge or a phone-displayed QR the primary format? | **OPEN** | Both work; the QR is a PNG image. No backend impact. |

**Known gaps (not decisions)**

| ID | Gap | Status |
| --- | --- | --- |
| G-1 | Web app (kiosk screen, admin dashboard) | **Kiosk screen built** (2026-10-16: React + Vite + TypeScript in `frontend/`, camera and USB/manual scanning, on-site list). **Admin dashboard not started** |
| G-2 | Nginx with TLS config | Not included |
| G-3 | `GET /people/{id}/qr` works only for a short time after a QR is issued (raw tokens are never stored in the database) | **Done** (2026-10-16): the token is cached in Redis with an expiry, so any worker can serve it; falls back to per-process memory without Redis |
| G-4 | Rate limits (30 req/min) must be shared across the 2-4 uvicorn workers | **Done** (2026-10-16): Redis counters, one fixed one-minute window per device or IP; falls back to per-process counting without Redis or if Redis is down |
| G-5 | Load test against the p95 < 300 ms target; monitoring | Not done |
| G-6 | Redis and the API are not yet run together in a tested container setup (`docker-compose.yml` has `db` and `redis`; the API `Dockerfile` is untested) | Open |
