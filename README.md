# LTS TimeTrack backend (FastAPI + PostgreSQL)

The source of truth is `doc/LTS TimeTrack - Detailed Design Document.md`. Schema reference: `doc/Database Schema.md`.

## One-time setup (Windows / PowerShell)

1. Install Python 3.12 (tick "Add to PATH"), Git, and Docker Desktop (or a local PostgreSQL 16).
2. In this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
Copy-Item .env.example .env          # then edit JWT_SECRET and the admin credentials
docker compose up -d db              # PostgreSQL on localhost:5432 (or use a local install, same URL)
alembic upgrade head                 # creates all tables (db/schema.sql)
python -m scripts.seed               # creates the first admin
uvicorn app.main:app --reload        # http://localhost:8000/docs
```

In VS Code: Ctrl+Shift+P > "Python: Select Interpreter" > `.venv`. Press F5 to debug the API.

## Trying the API (http://localhost:8000/docs)

1. `POST /auth/login` as the seeded admin, then click **Authorize** and paste the `access_token`.
2. `POST /users` to create a volunteer; `POST /devices` to register a kiosk (the `api_key` is shown once).
3. `POST /people` to register a teacher: the response has the one-time `qr_token` and `qr_image`
   (`GET /people/{id}/qr` returns the PNG for a short time after issue).
4. `POST /kiosk/scan` as the volunteer, with the header `X-Device-Key: <api_key>` and body `{"qr_token": "..."}`.
5. Admin: `GET /attendance/sessions`, `POST /attendance/sessions/{id}/correct`, `GET /reports/summary`,
   `GET /reports/export?format=csv|xlsx`, `GET /audit-logs`.

## Front end (kiosk screen)

```powershell
cd frontend
npm install
npm run dev                          # http://localhost:3000, proxies /api to the backend on :8000
```

See [frontend/README.md](frontend/README.md). Sign in as the admin (`admin@example.com`) for the admin screens: add a
person and print their badge. Sign in as a volunteer for the kiosk: enter the kiosk's device key once, then scan.

## Checks

```powershell
pytest                               # unit tests + integration tests (backend)
cd frontend; npm test                # front-end tests
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/health/db
```

Integration tests build a throw-away database `lts_timetrack_test` on the same server (default
`postgresql://postgres:dev@localhost:5432/postgres`; override with `TEST_PG_ADMIN_URL`). If PostgreSQL is not
reachable they are skipped and only the unit tests run.

## Nightly job

```powershell
python -m scripts.flag_open_sessions   # flags sessions left open past auto_close_time; never auto-closes
.\scripts\schedule_nightly_job.ps1     # registers a daily Windows Scheduled Task (default 00:05)
```

Flagged sessions show a `[FLAGGED ...]` note and stay OPEN; an admin resolves each with a correction. On Linux, call
the first command from cron or a scheduled container instead.

## Attendance rules (per person type)

`PUT /attendance-rules/{type}` sets `duplicate_window_seconds`, `auto_close_time` and `late_after_time`:

- `auto_close_time`: when an open session becomes stale. A scan after that voids it as a missed exit and starts a new
  entry; the nightly job flags it. Without one, a session is stale once its work date ends.
- `late_after_time`: the "Late entries" report column counts days whose first entry is after it. Unset = not tracked.

## Redis (optional, for several uvicorn workers)

```powershell
docker compose up -d redis                       # then set REDIS_URL=redis://localhost:6379/0 in .env
```

With `REDIS_URL` set, rate limits and the fresh-QR-image cache are shared by all workers. Without it (or if Redis is
down) each worker uses its own memory, which is fine for one worker.

## Layout

- `app/config.py`, `app/db.py`, `app/security.py`, `app/ratelimit.py`, `app/redis_client.py`, `app/main.py`: settings, async DB session, JWT/argon2/RBAC/device-key auth, rate limits, optional Redis, app + health.
- `app/models.py`: ORM models. The schema itself is owned by `db/schema.sql` via the Alembic migration `alembic/versions/0001_initial_schema.py`.
- `app/routers/`: `auth`, `users`, `people`, `person_types` (also attendance rules), `devices`, `kiosk`, `attendance`, `reports`, `audit`.
- `app/schemas/`: Pydantic request/response models.
- `app/services/`: `state_engine` (pure ENTRY/EXIT/DUPLICATE logic), `qr_service`, `attendance_service` (scan transaction), `audit_service` (audit rows + corrections), `report_service`, `maintenance_service` (nightly job), `session_flags` (stale-session cutoffs and note markers).
- `scripts/`: `seed.py` (first admin), `flag_open_sessions.py` (nightly job).
- `Dockerfile`, `pyproject.toml`: container image (uvicorn, 2 workers) and project metadata.

Schema changes: add a new Alembic revision (`alembic revision -m "..."`) instead of editing `db/schema.sql` after the first deploy.

## Known gaps against the design document

- Overtime is not in the reports (still an open question in the design document, OI-2).
- Nginx / TLS config is not included (deployment step).
- Redis support is tested with an in-memory fake only; run it against a real Redis before relying on it.
- The API Dockerfile is untested, and there is no load test against the p95 < 300 ms target yet.
- The admin front end is partly built (sign-in routing, dashboard, people and badges). Sessions and corrections, rules,
  devices, users, the audit log and reports still need screens; the backend endpoints for them already exist.
