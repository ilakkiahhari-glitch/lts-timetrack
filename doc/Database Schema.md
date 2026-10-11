# LTS TimeTrack – Database Schema

Generated from the live database on 2026-10-11. The source of truth is [db/schema.sql](../db/schema.sql), applied by the Alembic migration `0001_initial_schema`. Models are in [app/models.py](../app/models.py).

## Connection

| | |
|---|---|
| Engine | PostgreSQL 16 |
| Host / port | `localhost` / `5432` |
| Database | `lts_timetrack` |
| Schema | `public` |
| User / password (dev) | `postgres` / `dev` |
| App connection string | `postgresql+asyncpg://postgres:dev@localhost:5432/lts_timetrack` (`DATABASE_URL` in `.env`) |

Extensions: `pgcrypto` (UUID generation), `citext` (case-insensitive email).

## Overview

```text
users ───────────────┐ (operator_id, registered_by, actor_id)
                     │
person_types ──< people ──< attendance_sessions ──< attendance_events
      │                          │ (entry/exit device)        │ (device, operator)
      └──< attendance_rules      └──────────── devices ───────┘

audit_logs  (actor_id -> users; entity_type + entity_id point at any row, no FK)
```

| # | Table | Purpose | Rows are... |
|---|---|---|---|
| 1 | `users` | Logins: admins and volunteer operators | Updated |
| 2 | `person_types` | TEACHER, STUDENT, STAFF, VISITOR, ... (rows, not an enum) | Added by admin |
| 3 | `attendance_rules` | Per-type duplicate window and auto-close time | Updated |
| 4 | `people` | Anyone who can be scanned, with their QR token hash | Updated (deactivate, never delete) |
| 5 | `devices` | Registered kiosks and their hashed API key | Updated |
| 6 | `attendance_sessions` | One entry-to-exit pair per row | Updated by scans and corrections |
| 7 | `attendance_events` | Immutable log of every ENTRY/EXIT | **Append-only** |
| 8 | `audit_logs` | Who changed what, with before/after values | **Append-only** |
| - | `alembic_version` | Tracks the applied migration (`0001`) | Managed by Alembic |

## Enum types

| Type | Values |
|---|---|
| `user_role` | `ADMIN`, `VOLUNTEER` |
| `session_status` | `OPEN`, `CLOSED`, `VOIDED` |
| `event_type` | `ENTRY`, `EXIT` |
| `event_source` | `KIOSK`, `ADMIN_CORRECTION`, `SYSTEM` |
| `audit_action` | `CREATE`, `UPDATE`, `DELETE`, `CORRECT`, `LOGIN`, `LOGIN_FAILED`, `EXPORT`, `QR_ROTATE` |

---

## 1. `users`

Logins for admins and volunteers only. Created by an admin; people never log in.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `email` | citext | no | | Unique, case-insensitive |
| `password_hash` | text | no | | argon2id hash |
| `full_name` | text | no | | |
| `role` | user_role | no | | ADMIN or VOLUNTEER |
| `is_active` | boolean | no | `true` | Deactivate instead of deleting |
| `failed_logins` | integer | no | `0` | Reset on success; at 5 the account locks |
| `locked_until` | timestamptz | yes | | Set for 15 minutes after 5 failures |
| `last_login_at` | timestamptz | yes | | |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | Trigger `trg_users_updated` |

## 2. `person_types`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `code` | text | no | | Primary key, e.g. `TEACHER` |
| `display_name` | text | no | | |
| `is_active` | boolean | no | `true` | Inactive types cannot be used for new people |

Seeded: TEACHER, STUDENT, STAFF, VISITOR. A new type is one INSERT here plus one row in `attendance_rules` (the API does both).

## 3. `attendance_rules`

Rules are configuration, not code. One row per person type.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `person_type` | text | no | | Primary key, FK -> `person_types.code` |
| `duplicate_window_seconds` | integer | no | `30` | Check: `>= 0`. A scan inside this window of the last event is a DUPLICATE |
| `auto_close_time` | time | yes | | Local time; NULL = never flag open sessions (used by the future nightly job) |
| `updated_at` | timestamptz | no | `now()` | Set by the API (no trigger) |

## 4. `people`

Anyone who can be scanned. No link to `users`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `person_type` | text | no | | FK -> `person_types.code` |
| `external_code` | text | no | | Employee / student / badge number. Unique per type |
| `first_name` | text | no | | |
| `last_name` | text | no | | |
| `email` | citext | yes | | |
| `group_name` | text | yes | | Department, class or organisation |
| `attributes` | jsonb | no | `{}` | Type-specific fields (subject, room, grade, host...) |
| `qr_token_hash` | text | no | | SHA-256 of the QR token. **The raw token is never stored.** Unique |
| `qr_version` | integer | no | `1` | Incremented on each QR rotation |
| `qr_issued_at` | timestamptz | no | `now()` | |
| `qr_revoked_at` | timestamptz | yes | | A non-null value makes the QR invalid |
| `is_active` | boolean | no | `true` | Deactivate instead of deleting; history is kept |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | Trigger `trg_people_updated` |

Constraints: `UNIQUE (person_type, external_code)`, `UNIQUE (qr_token_hash)`.

## 5. `devices`

Registered kiosks.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `name` | text | no | | Unique |
| `location` | text | yes | | |
| `api_key_hash` | text | no | | SHA-256 of the device key. Raw key shown once. Unique |
| `is_active` | boolean | no | `true` | Inactive devices are rejected with 401 |
| `last_seen_at` | timestamptz | yes | | Updated on every kiosk request |
| `registered_by` | uuid | yes | | FK -> `users.id` |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | Trigger `trg_devices_updated` |

## 6. `attendance_sessions`

One entry-to-exit pair.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Primary key |
| `person_id` | uuid | no | | FK -> `people.id` |
| `entry_time` | timestamptz | no | | UTC |
| `exit_time` | timestamptz | yes | | NULL while the person is on site |
| `status` | session_status | no | `OPEN` | OPEN, CLOSED or VOIDED (replaced by a correction) |
| `entry_device_id` | uuid | yes | | FK -> `devices.id` |
| `exit_device_id` | uuid | yes | | FK -> `devices.id` |
| `duration_seconds` | integer | yes | generated | `exit_time - entry_time` in seconds; NULL while open |
| `work_date` | date | no | | School-local date of entry, set by the app from `SCHOOL_TZ` |
| `notes` | text | yes | | |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | Trigger `trg_sessions_updated` |

Constraints:
- `chk_exit_after_entry`: `exit_time IS NULL OR exit_time > entry_time`
- `chk_status_exit`: OPEN needs no exit time, CLOSED needs one, VOIDED is unrestricted
- `uq_one_open_session_per_person`: partial unique index on `(person_id) WHERE status = 'OPEN'`. This is the core rule: **one open session per person**.

## 7. `attendance_events`

Immutable scan log. Updates and deletes are blocked by trigger `trg_events_immutable`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | no | identity | Primary key |
| `session_id` | uuid | no | | FK -> `attendance_sessions.id` |
| `person_id` | uuid | no | | FK -> `people.id` |
| `event_type` | event_type | no | | ENTRY or EXIT |
| `event_time` | timestamptz | no | `now()` | UTC |
| `source` | event_source | no | `KIOSK` | KIOSK, ADMIN_CORRECTION or SYSTEM |
| `device_id` | uuid | yes | | FK -> `devices.id` |
| `operator_id` | uuid | yes | | FK -> `users.id`: the volunteer logged in at the kiosk |
| `created_at` | timestamptz | no | `now()` | |

Constraint: `uq_event_per_session_type` is unique on `(session_id, event_type)`, so each session has at most one ENTRY and one EXIT.

## 8. `audit_logs`

Append-only record of changes. Updates and deletes are blocked by trigger `trg_audit_immutable`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | no | identity | Primary key |
| `actor_id` | uuid | yes | | FK -> `users.id`. NULL for failed logins with an unknown email |
| `action` | audit_action | no | | See enum above |
| `entity_type` | text | no | | `user`, `person`, `device`, `person_type`, `attendance_rule`, `attendance_session` |
| `entity_id` | text | no | | ID (or email for unknown-user login failures) |
| `old_values` | jsonb | yes | | Before the change |
| `new_values` | jsonb | yes | | After the change |
| `reason` | text | yes | | Mandatory for corrections (enforced in the service) |
| `ip_address` | inet | yes | | |
| `user_agent` | text | yes | | |
| `created_at` | timestamptz | no | `now()` | |

---

## Indexes

| Table | Index | Columns | Purpose |
|---|---|---|---|
| `people` | `idx_people_name` | `(last_name, first_name)` | Name search and sorting |
| `people` | `idx_people_type` | `(person_type) WHERE is_active` | Filter active people by type |
| `attendance_sessions` | `uq_one_open_session_per_person` | `(person_id) WHERE status='OPEN'` | Unique: one open session per person |
| `attendance_sessions` | `idx_sessions_person_date` | `(person_id, work_date DESC)` | A person's history |
| `attendance_sessions` | `idx_sessions_work_date` | `(work_date)` | Reports by date |
| `attendance_events` | `idx_events_person_time` | `(person_id, event_time DESC)` | Duplicate-scan check (latest event) |
| `attendance_events` | `idx_events_session` | `(session_id)` | Events of a session |
| `attendance_events` | `uq_event_per_session_type` | `(session_id, event_type)` | Unique: one ENTRY and one EXIT per session |
| `audit_logs` | `idx_audit_entity` | `(entity_type, entity_id)` | History of one record |
| `audit_logs` | `idx_audit_actor` | `(actor_id, created_at DESC)` | Actions by a user |
| `audit_logs` | `idx_audit_time` | `(created_at DESC)` | Recent activity |

Unique constraints also create indexes: `users.email`, `people.qr_token_hash`, `people (person_type, external_code)`, `devices.name`, `devices.api_key_hash`.

## Foreign keys

| From | To |
|---|---|
| `attendance_rules.person_type` | `person_types.code` |
| `people.person_type` | `person_types.code` |
| `devices.registered_by` | `users.id` |
| `attendance_sessions.person_id` | `people.id` |
| `attendance_sessions.entry_device_id`, `exit_device_id` | `devices.id` |
| `attendance_events.session_id` | `attendance_sessions.id` |
| `attendance_events.person_id` | `people.id` |
| `attendance_events.device_id` | `devices.id` |
| `attendance_events.operator_id` | `users.id` |
| `audit_logs.actor_id` | `users.id` |

## Triggers and functions

| Trigger | Table | Fires on | Does |
|---|---|---|---|
| `trg_users_updated`, `trg_people_updated`, `trg_devices_updated`, `trg_sessions_updated` | the table named | UPDATE | Calls `set_updated_at()` to refresh `updated_at` |
| `trg_events_immutable` | `attendance_events` | UPDATE, DELETE | Calls `forbid_mutation()`, which raises "attendance_events is append-only" |
| `trg_audit_immutable` | `audit_logs` | UPDATE, DELETE | Calls `forbid_mutation()`, which raises "audit_logs is append-only" |

## View

`v_people_on_site`: who is on site right now. It joins open `attendance_sessions` to `people` and returns `person_id, person_type, external_code, first_name, last_name, session_id, entry_time`.

## Rules the database enforces on its own

- One open session per person (partial unique index).
- Exit time is after entry time, and status matches the presence of an exit time (check constraints).
- One ENTRY and one EXIT per session (unique index).
- Scan events and audit rows can't be changed or deleted (triggers).
- No duplicate QR token, device name, device key, email, or (type, external code).

## Useful queries

```sql
-- Who is on site now
SELECT * FROM v_people_on_site;

-- Today's sessions with names
SELECT p.external_code, p.first_name, p.last_name, s.entry_time, s.exit_time, s.duration_seconds, s.status
FROM attendance_sessions s JOIN people p ON p.id = s.person_id
WHERE s.work_date = CURRENT_DATE ORDER BY s.entry_time;

-- Scan log for one person
SELECT e.event_time, e.event_type, e.source, d.name AS device, u.email AS operator
FROM attendance_events e
LEFT JOIN devices d ON d.id = e.device_id
LEFT JOIN users u ON u.id = e.operator_id
WHERE e.person_id = (SELECT id FROM people WHERE external_code = 'T101')
ORDER BY e.event_time;

-- Recent audit trail
SELECT created_at, action, entity_type, entity_id, actor_id FROM audit_logs ORDER BY id DESC LIMIT 20;
```

## Changing the schema

Don't edit `db/schema.sql` after the first deploy. Create a new Alembic revision instead:

```powershell
.\.venv\Scripts\python.exe -m alembic revision -m "describe the change"
.\.venv\Scripts\python.exe -m alembic upgrade head
```
