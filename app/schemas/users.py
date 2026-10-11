import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["ADMIN", "VOLUNTEER"]


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    role: Role
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)  # admin password reset


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
