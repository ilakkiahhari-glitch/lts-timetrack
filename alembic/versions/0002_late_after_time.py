"""attendance_rules.late_after_time (design OI-2: late entries)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-16
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Local time; NULL = lateness is not tracked for this person type.
    op.execute("ALTER TABLE attendance_rules ADD COLUMN late_after_time TIME")


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_rules DROP COLUMN late_after_time")
