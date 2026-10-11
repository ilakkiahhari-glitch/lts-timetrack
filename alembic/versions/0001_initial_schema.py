"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-07
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


def upgrade() -> None:
    # The driver treats '%' as a parameter marker; escape it (e.g. RAISE EXCEPTION '% is append-only').
    op.get_bind().exec_driver_sql(SCHEMA_SQL.read_text(encoding="utf-8").replace("%", "%%"))


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_people_on_site")
    for table in (
        "audit_logs", "attendance_events", "attendance_sessions", "devices",
        "people", "attendance_rules", "person_types", "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    for fn in ("forbid_mutation", "set_updated_at"):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}() CASCADE")
    for enum in ("audit_action", "event_source", "event_type", "session_status", "user_role"):
        op.execute(f"DROP TYPE IF EXISTS {enum}")
