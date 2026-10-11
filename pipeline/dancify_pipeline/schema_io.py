"""Validate and write dance.json against frozen schema."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft7Validator

from .scoring_contract import scorable_pose

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_CANDIDATES = (
    REPO_ROOT / "schema" / "dance.schema.json",
    REPO_ROOT / "schema" / "dance.schema.json.json",
)


def load_schema() -> dict[str, Any]:
    for path in SCHEMA_CANDIDATES:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(
        "Schema not found; expected schema/dance.schema.json "
        "(or legacy schema/dance.schema.json.json)"
    )


def _finite_positive(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{name} must be finite")
    number = float(value)
    if number <= 0:
        raise ValueError(f"{name} must be positive")
    return number


def validate_dance_semantics(doc: dict[str, Any]) -> None:
    """Validate timeline and keyframe invariants absent from the frozen schema."""
    _finite_positive(doc["bpm"], "bpm")
    duration = _finite_positive(doc["duration"], "duration")

    beats = [float(value) for value in doc["beat_times"]]
    if any(not math.isfinite(value) for value in beats):
        raise ValueError("beat_times must be finite")
    if any(value < 0 or value > duration for value in beats):
        raise ValueError("beat_times must be within [0, duration]")
    if any(right <= left for left, right in zip(beats, beats[1:])):
        raise ValueError("beat_times must be strictly increasing")

    if not doc["moves"]:
        raise ValueError("moves must contain at least one usable target")
    seen_ids: set[str] = set()
    previous_end = -1.0
    for index, move in enumerate(doc["moves"]):
        move_id = move["id"]
        if move_id in seen_ids:
            raise ValueError(f"moves/{index}/id must be unique")
        seen_ids.add(move_id)
        start = float(move["start"])
        end = float(move["end"])
        if not math.isfinite(start) or not math.isfinite(end):
            raise ValueError(f"moves/{index} times must be finite")
        if not (0 <= start < end <= duration):
            raise ValueError(
                f"moves/{index} must satisfy 0 <= start < end <= duration"
            )
        if start < previous_end:
            raise ValueError("moves must be chronological and non-overlapping")
        previous_end = end
        if move["is_hold"] is not False:
            raise ValueError(f"moves/{index}/is_hold=true is not supported")
        keyframe = np.asarray(move["keyframe_landmarks"], dtype=np.float64)
        if not scorable_pose(keyframe):
            raise ValueError(f"moves/{index} has no usable visible full-body keyframe (12 joints and noncollapsed geometry required)")


def validate_dance(doc: dict[str, Any]) -> None:
    schema = load_schema()
    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(doc), key=lambda e: e.path)
    if errors:
        msgs = "; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errors[:8])
        raise ValueError(f"dance.json failed schema validation: {msgs}")
    validate_dance_semantics(doc)


def write_dance_json(doc: dict[str, Any], path: Path) -> Path:
    validate_dance(doc)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return path
