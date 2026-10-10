from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Any

from jsonschema import Draft7Validator

from .paths import CHART_SCHEMA_PATH

VISIBILITY_THRESHOLD = 0.35
MIN_VISIBLE_JOINTS = 6
NONZERO_TOLERANCE = 1e-8
SCORE_LANDMARK_INDEXES = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)


class ChartValidationError(ValueError):
    pass


class ChartSyntaxError(ChartValidationError):
    pass


@lru_cache(maxsize=1)
def _validator() -> Draft7Validator:
    with CHART_SCHEMA_PATH.open(encoding="utf-8") as schema_file:
        schema = json.load(schema_file)
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def _finite_number(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (OverflowError, TypeError, ValueError) as exc:
        raise ChartValidationError(f"{field} must be a finite number") from exc
    if not math.isfinite(number):
        raise ChartValidationError(f"{field} must be finite")
    return number


def validate_chart(raw: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ChartSyntaxError(f"Invalid JSON: {exc}") from exc

    errors = sorted(
        _validator().iter_errors(payload),
        key=lambda error: tuple(str(part) for part in error.path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path) or "chart"
        raise ChartValidationError(f"{location}: {error.message}")

    duration = _finite_number(payload["duration"], "duration")
    bpm = _finite_number(payload["bpm"], "bpm")
    if duration <= 0:
        raise ChartValidationError("duration must be greater than zero")
    if bpm <= 0:
        raise ChartValidationError("bpm must be greater than zero")
    if not payload["beat_times"]:
        raise ChartValidationError("beat_times must contain at least one beat")
    if not payload["moves"]:
        raise ChartValidationError("moves must contain at least one move")

    previous_beat = -1.0
    for index, beat in enumerate(payload["beat_times"]):
        value = _finite_number(beat, f"beat_times[{index}]")
        if value < 0 or value > duration:
            raise ChartValidationError(
                f"beat_times[{index}] must be between zero and duration"
            )
        if value <= previous_beat:
            raise ChartValidationError("beat_times must be strictly increasing")
        previous_beat = value

    move_ids: set[str] = set()
    for move_index, move in enumerate(payload["moves"]):
        move_id = move["id"].strip()
        if not move_id:
            raise ChartValidationError(f"moves[{move_index}].id must not be blank")
        if move_id in move_ids:
            raise ChartValidationError(f"duplicate move id: {move_id}")
        move_ids.add(move_id)

        start = _finite_number(move["start"], f"moves[{move_index}].start")
        end = _finite_number(move["end"], f"moves[{move_index}].end")
        if start < 0 or end <= start or end > duration:
            raise ChartValidationError(
                f"moves[{move_index}] must satisfy 0 <= start < end <= duration"
            )

        for landmark_index, landmark in enumerate(move["keyframe_landmarks"]):
            for coordinate_index, coordinate in enumerate(landmark):
                _finite_number(
                    coordinate,
                    "moves"
                    f"[{move_index}].keyframe_landmarks"
                    f"[{landmark_index}][{coordinate_index}]",
                )
            visibility = float(landmark[3])
            if visibility < 0 or visibility > 1:
                raise ChartValidationError(
                    "moves"
                    f"[{move_index}].keyframe_landmarks"
                    f"[{landmark_index}][3] must be between zero and one"
                )

        visible_indexes = [
            index
            for index in SCORE_LANDMARK_INDEXES
            if float(move["keyframe_landmarks"][index][3]) >= VISIBILITY_THRESHOLD
        ]
        if len(visible_indexes) < MIN_VISIBLE_JOINTS:
            raise ChartValidationError(
                f"moves[{move_index}] needs at least {MIN_VISIBLE_JOINTS} "
                f"gameplay joints with visibility >= {VISIBILITY_THRESHOLD}"
            )
        visible_geometry = (
            move["keyframe_landmarks"][index][:3] for index in visible_indexes
        )
        if all(
            abs(float(coordinate)) <= NONZERO_TOLERANCE
            for landmark in visible_geometry
            for coordinate in landmark
        ):
            raise ChartValidationError(
                f"moves[{move_index}] has no usable nonzero visible pose geometry"
            )

    return payload
