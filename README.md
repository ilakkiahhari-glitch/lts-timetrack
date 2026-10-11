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

## Checks

```powershell
pytest                               # unit tests + integration tests
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/health/db
```

Integration tests build a throw-away database `lts_timetrack_test` on the same server (default
`postgresql://postgres:dev@localhost:5432/postgres`; override with `TEST_PG_ADMIN_URL`). If PostgreSQL is not
reachable they are skipped and only the unit tests run.

## Nightly job

```powershell
python -m scripts.flag_open_sessions   # flags sessions left open past auto_close_time; never auto-closes
```

Schedule it nightly (Task Scheduler / cron). Flagged sessions show a `[FLAGGED ...]` note; an admin resolves each
with a correction.

## Layout

- `app/config.py`, `app/db.py`, `app/security.py`, `app/ratelimit.py`, `app/main.py`: settings, async DB session, JWT/argon2/RBAC/device-key auth, rate limits, app + health.
- `app/models.py`: ORM models. The schema itself is owned by `db/schema.sql` via the Alembic migration `alembic/versions/0001_initial_schema.py`.
- `app/routers/`: `auth`, `users`, `people`, `person_types` (also attendance rules), `devices`, `kiosk`, `attendance`, `reports`, `audit`.
- `app/schemas/`: Pydantic request/response models.
- `app/services/`: `state_engine` (pure ENTRY/EXIT/DUPLICATE logic), `qr_service`, `attendance_service` (scan transaction), `audit_service` (audit rows + corrections), `report_service`, `maintenance_service` (nightly job).
- `scripts/`: `seed.py` (first admin), `flag_open_sessions.py` (nightly job).
- `Dockerfile`, `pyproject.toml`: container image (uvicorn, 2 workers) and project metadata.

Schema changes: add a new Alembic revision (`alembic revision -m "..."`) instead of editing `db/schema.sql` after the first deploy.

## Known gaps against the design document

- Reports have no "late entries" column: the design leaves the lateness threshold as an open question.
- Nginx / TLS config is not included (deployment step).
- Rate limits and the short-lived QR image cache are per process; with several uvicorn workers each counts separately.
- The web front end (kiosk screen, admin dashboard) is not built.
