from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SongStatus = Literal["pending", "processing", "ready", "failed"]
Judgment = Literal["PERFECT", "SUPER", "GOOD", "MISS", "LOST"]
NonNegativeInt = Annotated[int, Field(ge=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _http_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source_url must be an absolute HTTP(S) URL")
    return value


class SongCreate(StrictModel):
    title: str = Field(..., min_length=1, max_length=256)
    source_url: str | None = Field(default=None, min_length=1, max_length=1024)

    @field_validator("source_url", mode="after")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        return _http_url(value)


class SongUpdate(StrictModel):
    title: str | None = Field(None, min_length=1, max_length=256)
    source_url: str | None = Field(default=None, min_length=1, max_length=1024)
    status: SongStatus | None = None
    error_message: str | None = Field(default=None, max_length=4000)

    @field_validator("source_url", mode="after")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        return _http_url(value)

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "SongUpdate":
        for field in ("title", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} must not be null")
        return self


class SongOut(BaseModel):
    id: str
    title: str
    source_url: str | None
    status: str
    error_message: str | None
    has_video: bool
    has_audio: bool
    has_chart: bool
    bpm: float | None
    duration: float | None
    move_count: int | None
    created_at: datetime
    updated_at: datetime
    processed_at: datetime | None
    play_count: int = 0

    model_config = {"from_attributes": True}


class PlayCreate(StrictModel):
    player_name: str = Field(default="anonymous", max_length=128)
    score: int = Field(default=0, ge=0)
    accuracy: float | None = Field(default=None, ge=0, le=1)
    max_combo: int | None = Field(default=None, ge=0)
    judgments: dict[Judgment, NonNegativeInt] | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("player_name", mode="after")
    @classmethod
    def anonymous_for_blank_name(cls, value: str) -> str:
        return value or "anonymous"


class PlayOut(BaseModel):
    id: str
    song_id: str
    player_name: str
    score: int
    accuracy: float | None
    max_combo: int | None
    judgments: dict[str, Any] | None = None
    notes: str | None
    played_at: datetime

    model_config = {"from_attributes": True}


class HealthOut(BaseModel):
    ok: bool
    service: str
    db: str
