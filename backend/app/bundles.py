"""Immutable bundle staging and atomic active-generation publication."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from .chart_validation import validate_chart
from .media import validate_bundle_media
from .models import PreparationJob, Song, utcnow
from .paths import resolve_stored_path, song_dir, stored_path
from .report_validation import ReportValidationError, validate_report


@dataclass(frozen=True)
class PublishedBundle:
    bundle_id: str
    chart: dict[str, Any]
    media: dict[str, Any]
    directory: Path


def _load_report(raw: bytes) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite constant {value}")

    try:
        payload = json.loads(
            raw.decode("utf-8"),
            parse_constant=reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ReportValidationError(f"Invalid report JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ReportValidationError("Report must be a JSON object")
    try:
        json.dumps(payload, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ReportValidationError(f"Invalid report value: {exc}") from exc
    return payload


def _copy(source: Path, destination: Path) -> None:
    if not source.is_file() or source.stat().st_size <= 0:
        raise FileNotFoundError(f"Missing bundle asset: {source}")
    shutil.copyfile(source, destination)
    with destination.open("rb") as handle:
        os.fsync(handle.fileno())


def publish_bundle(
    db: Session,
    song: Song,
    *,
    video_path: Path,
    chart_bytes: bytes,
    audio_path: Path,
    report_bytes: bytes,
    preparation_job: PreparationJob | None = None,
) -> PublishedBundle:
    """Validate and publish one whole generation, then switch DB pointers once."""
    chart = validate_chart(chart_bytes)
    report = _load_report(report_bytes)
    validate_report(report, chart)
    media = validate_bundle_media(
        video_path,
        audio_path,
        float(chart["duration"]),
    )
    if abs(report["normalization"]["aspect_ratio"] - media["aspect_ratio"]) > 0.0001:
        raise ReportValidationError("Report aspect ratio does not match the reference video")

    bundle_id = str(uuid.uuid4())
    folder = song_dir(song.id)
    staged = folder / f".bundle-{bundle_id}.tmp"
    final = folder / f"bundle-{bundle_id}"
    staged.mkdir()
    try:
        _copy(video_path, staged / "video.mp4")
        (staged / "dance.json").write_bytes(chart_bytes)
        _copy(audio_path, staged / "audio.wav")
        report["cache"] = {
            "bundle_id": bundle_id,
            "song_id": song.id,
            "preparation_job_id": preparation_job.id if preparation_job else None,
            "source_kind": preparation_job.source_kind if preparation_job else "manual",
            "verification": "local_preparation" if preparation_job else "manual_report",
            "published_at": utcnow().isoformat(),
            "media": media,
        }
        (staged / "dance.report.json").write_text(
            json.dumps(report, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        os.replace(staged, final)
    except Exception:
        shutil.rmtree(staged, ignore_errors=True)
        shutil.rmtree(final, ignore_errors=True)
        raise

    song.video_path = stored_path(final / "video.mp4")
    song.chart_path = stored_path(final / "dance.json")
    song.audio_path = stored_path(final / "audio.wav")
    song.report_path = stored_path(final / "dance.report.json")
    song.active_bundle_id = bundle_id
    song.active_preparation_job_id = preparation_job.id if preparation_job else None
    song.bpm = float(chart["bpm"])
    song.duration = float(chart["duration"])
    song.move_count = len(chart["moves"])
    song.status = "ready"
    song.error_message = None
    song.processed_at = utcnow()
    song.updated_at = utcnow()
    if preparation_job is not None:
        preparation_job.status = "succeeded"
        preparation_job.stage = "complete"
        preparation_job.error_code = None
        preparation_job.error_message = None
        preparation_job.report_path = song.report_path
        preparation_job.result_bundle_id = bundle_id
        preparation_job.finished_at = utcnow()
        preparation_job.updated_at = utcnow()
    try:
        db.commit()
    except Exception:
        db.rollback()
        shutil.rmtree(final, ignore_errors=True)
        raise
    db.refresh(song)
    if preparation_job is not None:
        db.refresh(preparation_job)
    return PublishedBundle(
        bundle_id=bundle_id,
        chart=chart,
        media=media,
        directory=final,
    )


def bundle_asset_path(song_id: str, bundle_id: str, asset: str) -> Path | None:
    try:
        normalized = str(uuid.UUID(bundle_id))
    except ValueError:
        return None
    if normalized != bundle_id:
        return None
    filenames = {
        "video": "video.mp4",
        "chart": "dance.json",
        "audio": "audio.wav",
        "report": "dance.report.json",
    }
    filename = filenames.get(asset)
    if filename is None:
        return None
    path = song_dir(song_id, create=False) / f"bundle-{bundle_id}" / filename
    resolved = resolve_stored_path(stored_path(path)) if path.exists() else None
    return resolved if resolved and resolved.is_file() else None
