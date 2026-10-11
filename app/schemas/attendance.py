import uuid
from datetime import date, datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    event_time: datetime
    source: str
    device_id: uuid.UUID | None
    operator_id: uuid.UUID | None


class SessionOut(BaseModel):
    id: uuid.UUID
    person_id: uuid.UUID
    external_code: str
    person_name: str
    person_type: str
    entry_time: datetime
    exit_time: datetime | None
    status: str
    duration_seconds: int | None
    work_date: date
    notes: str | None
    entry_device_id: uuid.UUID | None
    exit_device_id: uuid.UUID | None


class SessionDetail(SessionOut):
    events: list[EventOut]


class CorrectionRequest(BaseModel):
    entry_time: AwareDatetime
    exit_time: AwareDatetime
    reason: str = Field(description="Mandatory")

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("A reason is required for corrections")
        return v.strip()

    @model_validator(mode="after")
    def exit_after_entry(self):
        if self.exit_time <= self.entry_time:
            raise ValueError("exit_time must be after entry_time")
        return self


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str
    old_values: dict | None
    new_values: dict | None
    reason: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime

    @field_validator("ip_address", mode="before")
    @classmethod
    def ip_to_str(cls, v):
        return None if v is None else str(v)
