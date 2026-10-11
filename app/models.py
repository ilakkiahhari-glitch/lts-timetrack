"""SQLAlchemy ORM models.

The database schema is owned by the Alembic migration (db/schema.sql). These models mirror it for
queries; indexes, triggers and partial unique indexes live only in the migration.
"""

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, ENUM, INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

UserRole = ENUM("ADMIN", "VOLUNTEER", name="user_role", create_type=False)
SessionStatus = ENUM("OPEN", "CLOSED", "VOIDED", name="session_status", create_type=False)
EventType = ENUM("ENTRY", "EXIT", name="event_type", create_type=False)
EventSource = ENUM("KIOSK", "ADMIN_CORRECTION", "SYSTEM", name="event_source", create_type=False)
AuditAction = ENUM(
    "CREATE", "UPDATE", "DELETE", "CORRECT", "LOGIN", "LOGIN_FAILED", "EXPORT", "QR_ROTATE",
    name="audit_action", create_type=False,
)

TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(UserRole)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    failed_logins: Mapped[int] = mapped_column(Integer, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(TS)
    last_login_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class PersonType(Base):
    __tablename__ = "person_types"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    display_name: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")


class AttendanceRule(Base):
    __tablename__ = "attendance_rules"

    person_type: Mapped[str] = mapped_column(ForeignKey("person_types.code"), primary_key=True)
    duplicate_window_seconds: Mapped[int] = mapped_column(Integer, server_default="30")
    auto_close_time: Mapped[time | None] = mapped_column(Time)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class Person(Base):
    __tablename__ = "people"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    person_type: Mapped[str] = mapped_column(ForeignKey("person_types.code"))
    external_code: Mapped[str] = mapped_column(Text)
    first_name: Mapped[str] = mapped_column(Text)
    last_name: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(CITEXT)
    group_name: Mapped[str | None] = mapped_column(Text)
    attributes: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    qr_token_hash: Mapped[str] = mapped_column(Text, unique=True)
    qr_version: Mapped[int] = mapped_column(Integer, server_default="1")
    qr_issued_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    qr_revoked_at: Mapped[datetime | None] = mapped_column(TS)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(Text, unique=True)
    location: Mapped[str | None] = mapped_column(Text)
    api_key_hash: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    last_seen_at: Mapped[datetime | None] = mapped_column(TS)
    registered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"))
    entry_time: Mapped[datetime] = mapped_column(TS)
    exit_time: Mapped[datetime | None] = mapped_column(TS)
    status: Mapped[str] = mapped_column(SessionStatus, server_default="OPEN")
    entry_device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    exit_device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        Computed(
            "CASE WHEN exit_time IS NOT NULL "
            "THEN EXTRACT(EPOCH FROM (exit_time - entry_time))::INT END",
            persisted=True,
        ),
    )
    work_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class AttendanceEvent(Base):
    __tablename__ = "attendance_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"))
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("people.id"))
    event_type: Mapped[str] = mapped_column(EventType)
    event_time: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    source: Mapped[str] = mapped_column(EventSource, server_default="KIOSK")
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    operator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(AuditAction)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[str] = mapped_column(Text)
    old_values: Mapped[dict | None] = mapped_column(JSONB)
    new_values: Mapped[dict | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
