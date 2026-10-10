from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SongCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    source_url: str | None = None


class SongUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=256)
    source_url: str | None = None
    status: str | None = None
    error_message: str | None = None
    bpm: float | None = None
    duration: float | None = None
    move_count: int | None = None


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


class PlayCreate(BaseModel):
    player_name: str = Field(default="anonymous", max_length=128)
    score: int = 0
    accuracy: float | None = None
    max_combo: int | None = None
    judgments: dict[str, int] | None = None
    notes: str | None = None


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
