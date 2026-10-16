import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class PersonCreate(BaseModel):
    person_type: str
    external_code: str = Field(min_length=1)
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    email: EmailStr | None = None
    group_name: str | None = None
    attributes: dict = Field(default_factory=dict)


class PersonUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1)
    last_name: str | None = Field(default=None, min_length=1)
    email: EmailStr | None = None
    group_name: str | None = None
    attributes: dict | None = None
    is_active: bool | None = None


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    person_type: str
    external_code: str
    first_name: str
    last_name: str
    email: str | None
    group_name: str | None
    attributes: dict
    qr_version: int
    qr_issued_at: datetime
    is_active: bool
    created_at: datetime


class PersonWithQr(PersonOut):
    """Returned only when a QR is issued. The raw token cannot be retrieved afterwards."""

    qr_token: str
    qr_image: str  # PNG data: URI


class PersonTypeCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{1,31}$")
    display_name: str = Field(min_length=1)


class PersonTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    display_name: str
    is_active: bool


class RuleUpdate(BaseModel):
    duplicate_window_seconds: int = Field(ge=0)
    auto_close_time: time | None = None
    late_after_time: time | None = None  # local time; first ENTRY of a day after this is "late". None = not tracked


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    person_type: str
    duplicate_window_seconds: int
    auto_close_time: time | None
    late_after_time: time | None
    updated_at: datetime
