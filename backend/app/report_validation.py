"""Validate the pose/timing contract without changing the frozen chart schema."""

from __future__ import annotations

import math
from typing import Any


class ReportValidationError(ValueError):
    pass


def validate_report(report: dict[str, Any], chart: dict[str, Any]) -> None:
    """Only the current, audio-timed solo pipeline is eligible for scored play.

    A valid manual report is an assertion by its uploader, not proof of media
    identity. Publication records that provenance separately from worker output.
    """
    def require(condition: bool, message: str) -> None:
        if not condition:
            raise ReportValidationError(message)

    def section(name: str) -> dict[str, Any]:
        value = report.get(name)
        require(isinstance(value, dict), f"Missing {name}; regenerate with the current pipeline")
        return value

    def number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    require(report.get("version") == "1.0", "Unsupported report version")
    require(report.get("status") != "failed", "Preparation report records failure")
    readiness = section("readiness")
    require(readiness.get("cache_ready_by_default") is True, "Report is not cache-ready")
    require(readiness.get("synthetic_timing") is False, "Synthetic timing is not supported for scored play")
    require(readiness.get("solo_cfr_mvp") is True, "Unsupported input contract")
    normalization = section("normalization")
    require(normalization.get("coordinate_space") == "mediapipe_image", "Unsupported pose coordinate space")
    require(normalization.get("x_z_scaled_by_aspect_ratio") is True, "Legacy normalization; regenerate the chart")
    aspect = normalization.get("aspect_ratio")
    require(number(aspect) and aspect > 0, "Invalid normalization aspect ratio")
    timing = section("timing")
    require(timing.get("source") == "audio" and timing.get("synthetic") is False, "Audio-derived timing is required")
    bpm = timing.get("bpm")
    require(number(bpm) and abs(bpm - chart["bpm"]) <= 0.001, "Report BPM does not match chart")
    beats = timing.get("beat_times")
    require(isinstance(beats, list) and len(beats) == len(chart["beat_times"]), "Report beat grid does not match chart")
    require(all(number(a) and abs(a - b) <= 0.00011 for a, b in zip(beats, chart["beat_times"])), "Report beat grid does not match chart")
    tracking = section("tracking")
    valid, total = tracking.get("valid_frames"), tracking.get("total_frames")
    require(type(valid) is int and type(total) is int and 0 < valid <= total, "Invalid tracking frame counts")
    ratio = tracking.get("valid_frame_ratio")
    require(number(ratio) and 0.5 <= ratio <= 1 and abs(ratio - valid / total) < 0.0001, "Invalid tracking coverage")
    for field in ("longest_invalid_seconds", "trailing_invalid_seconds"):
        value = tracking.get(field)
        require(number(value) and 0 <= value <= 2.000001, f"Invalid tracking gate: {field}")
