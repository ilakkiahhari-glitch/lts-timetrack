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
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO attendance_rules (person_type) SELECT code FROM person_types;

-- 4. PEOPLE (anyone who can be scanned; people never log in)
CREATE TABLE people (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
