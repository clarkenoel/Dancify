"""FFprobe checks for browser-playable, timeline-aligned bundle media."""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any


class MediaValidationError(ValueError):
    pass


DEFAULT_DURATION_TOLERANCE = float(
    os.environ.get("DANCIFY_MEDIA_DURATION_TOLERANCE", "0.25")
)


def _probe(path: Path) -> dict[str, Any]:
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_error",
            "-count_frames",
            "-show_entries",
            (
                "format=format_name,duration,start_time:"
                "stream=codec_type,codec_name,duration,start_time,nb_read_frames,width,height"
            ),
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode:
        detail = process.stderr.strip() or process.stdout.strip()
        raise MediaValidationError(
            f"ffprobe could not read {path.name}: {detail[-1000:]}"
        )
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError as exc:
        raise MediaValidationError(
            f"ffprobe returned invalid JSON for {path.name}"
        ) from exc
    if payload.get("error"):
        raise MediaValidationError(f"ffprobe rejected {path.name}")
    return payload


def _positive_duration(
    probe: dict[str, Any], stream: dict[str, Any] | None, label: str
) -> float:
    candidates = [
        stream.get("duration") if stream else None,
        probe.get("format", {}).get("duration"),
    ]
    for value in candidates:
        try:
            duration = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(duration) and duration > 0:
            return duration
    raise MediaValidationError(f"{label} must have a positive duration")


def _first_stream(probe: dict[str, Any], kind: str) -> dict[str, Any] | None:
    return next(
        (
            stream
            for stream in probe.get("streams", [])
            if stream.get("codec_type") == kind
        ),
        None,
    )


def _require_decodable_frames(stream: dict[str, Any], label: str) -> None:
    try:
        count = int(stream.get("nb_read_frames"))
    except (TypeError, ValueError) as exc:
        raise MediaValidationError(
            f"ffprobe could not decode/count {label} frames"
        ) from exc
    if count <= 0:
        raise MediaValidationError(f"{label} stream contains no decodable frames")


def validate_bundle_media(
    video_path: Path,
    audio_path: Path,
    chart_duration: float,
    *,
    tolerance: float = DEFAULT_DURATION_TOLERANCE,
) -> dict[str, Any]:
    """Require MP4/H.264/AAC video plus a decodable, synchronized audio sidecar."""
    video_probe = _probe(video_path)
    video_stream = _first_stream(video_probe, "video")
    embedded_audio = _first_stream(video_probe, "audio")
    if video_stream is None:
        raise MediaValidationError("Reference media has no video stream")
    if embedded_audio is None:
        raise MediaValidationError("Reference video must contain an audio stream")

    format_names = set(
        str(video_probe.get("format", {}).get("format_name", "")).split(",")
    )
    if not format_names.intersection({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}):
        raise MediaValidationError("Reference video must use an MP4 container")
    if video_stream.get("codec_name") != "h264":
        raise MediaValidationError("Reference video codec must be H.264")
    if embedded_audio.get("codec_name") != "aac":
        raise MediaValidationError("Embedded audio codec must be AAC")
    _require_decodable_frames(video_stream, "video")
    _require_decodable_frames(embedded_audio, "embedded audio")

    audio_probe = _probe(audio_path)
    sidecar_audio = _first_stream(audio_probe, "audio")
    if sidecar_audio is None:
        raise MediaValidationError("Audio sidecar has no audio stream")
    _require_decodable_frames(sidecar_audio, "audio sidecar")

    video_duration = _positive_duration(video_probe, video_stream, "Video")
    embedded_audio_duration = _positive_duration(
        video_probe, embedded_audio, "Embedded audio"
    )
    sidecar_duration = _positive_duration(audio_probe, sidecar_audio, "Audio sidecar")
    try:
        expected_duration = float(chart_duration)
    except (TypeError, ValueError) as exc:
        raise MediaValidationError("Chart duration must be numeric") from exc
    if not math.isfinite(expected_duration) or expected_duration <= 0:
        raise MediaValidationError("Chart duration must be positive")

    # Percentage tolerances grow beyond an entire scoring window on long clips.
    allowed_delta = tolerance
    durations = {
        "video": video_duration,
        "embedded_audio": embedded_audio_duration,
        "audio": sidecar_duration,
    }
    for label, duration in durations.items():
        if abs(duration - expected_duration) > allowed_delta:
            raise MediaValidationError(
                f"{label} duration {duration:.3f}s does not align with "
                f"chart duration {expected_duration:.3f}s "
                f"(tolerance {allowed_delta:.3f}s)"
            )

    for label, stream in (("video", video_stream), ("embedded_audio", embedded_audio), ("audio", sidecar_audio)):
        try:
            start = float(stream.get("start_time", 0))
        except (TypeError, ValueError) as exc:
            raise MediaValidationError(f"Invalid {label} start time") from exc
        if not math.isfinite(start) or abs(start) > tolerance:
            raise MediaValidationError(f"{label} must use the zero-based video timeline")
    width, height = video_stream.get("width"), video_stream.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        raise MediaValidationError("Reference video dimensions are invalid")

    return {
        "container": "mp4",
        "video_codec": "h264",
        "audio_codec": "aac",
        "duration": video_duration,
        "embedded_audio_duration": embedded_audio_duration,
        "sidecar_duration": sidecar_duration,
        "tolerance": allowed_delta,
        "aspect_ratio": width / height,
    }
