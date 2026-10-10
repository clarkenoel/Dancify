from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, text
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
    source_video_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    chart_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    report_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    active_bundle_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    active_preparation_job_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )

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
    preparation_jobs: Mapped[list["PreparationJob"]] = relationship(
        back_populates="song", cascade="all, delete-orphan"
    )


class Play(Base):
    __tablename__ = "plays"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    song_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bundle_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    player_name: Mapped[str] = mapped_column(String(128), default="anonymous", nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_combo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # PERFECT / SUPER / GOOD / MISS / LOST counts as JSON string
    judgments_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    song: Mapped["Song"] = relationship(back_populates="plays")


class PreparationJob(Base):
    __tablename__ = "preparation_jobs"
    __table_args__ = (
        Index(
            "uq_preparation_jobs_active_song",
            "song_id",
            unique=True,
            sqlite_where=text("status IN ('queued', 'processing')"),
        ),
        Index(
            "uq_preparation_jobs_song_attempt",
            "song_id",
            "attempt",
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    song_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # queued | processing | succeeded | failed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    stage: Mapped[str] = mapped_column(String(64), nullable=False, default="queued")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    retried_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    start_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_time: Mapped[float | None] = mapped_column(Float, nullable=True)

    report_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    diagnostic_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    diagnostic_video_path: Mapped[str | None] = mapped_column(
        String(512), nullable=True
    )
    result_bundle_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    song: Mapped["Song"] = relationship(back_populates="preparation_jobs")
