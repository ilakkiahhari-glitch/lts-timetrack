import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1)
    location: str | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    location: str | None = None
    is_active: bool | None = None
    rotate_key: bool = False


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    location: str | None
    is_active: bool
    last_seen_at: datetime | None
    created_at: datetime


class DeviceWithKey(DeviceOut):
    """Returned only when a key is issued. The raw key cannot be retrieved afterwards."""

    api_key: str
