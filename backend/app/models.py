from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # pending | processing | ready | failed
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    video_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    chart_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    move_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plays: Mapped[list["Play"]] = relationship(
        back_populates="song", cascade="all, delete-orphan"
    )


class Play(Base):
    __tablename__ = "plays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    song_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    player_name: Mapped[str] = mapped_column(String(128), default="anonymous", nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_combo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PERFECT / SUPER / GOOD / MISS / LOST counts as JSON string
    judgments_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    song: Mapped["Song"] = relationship(back_populates="plays")
