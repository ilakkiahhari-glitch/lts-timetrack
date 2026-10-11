from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ScanRequest(BaseModel):
    qr_token: str = Field(min_length=1)


class ScanResponse(BaseModel):
    result: Literal["ENTRY", "EXIT", "DUPLICATE"]
    person: str  # "A. Rivera": enough to confirm at the kiosk, no full personal data
    person_type: str
    message: str
    time: datetime | None = None
    duration_seconds: int | None = None


class OnSiteEntry(BaseModel):
    person: str
    person_type: str
    entry_time: datetime
