from __future__ import annotations

import copy
from pathlib import Path

import numpy as np
import pytest

from dancify_pipeline.schema_io import validate_dance, write_dance_json


def _document(landmarks: np.ndarray) -> dict:
    return {
        "version": "1.0",
        "bpm": 120.0,
        "beat_times": [0.0, 0.5, 1.0],
        "duration": 1.0,
        "moves": [
            {
                "id": "m0",
                "start": 0.25,
                "end": 0.75,
                "keyframe_landmarks": landmarks.tolist(),
                "is_hold": False,
            }
        ],
    }


def test_semantic_chart_accepts_valid_document(valid_landmarks: np.ndarray) -> None:
    validate_dance(_document(valid_landmarks))


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("bpm", -1.0, "positive"),
        ("duration", float("nan"), "finite"),
        ("beat_times", [0.5, 0.25], "increasing"),
        ("beat_times", [0.0, 2.0], "within"),
    ],
)
def test_semantic_chart_rejects_bad_timeline(
    valid_landmarks: np.ndarray,
    field: str,
    value: object,
    message: str,
) -> None:
    doc = _document(valid_landmarks)
    doc[field] = value
    with pytest.raises(ValueError, match=message):
        validate_dance(doc)


def test_semantic_chart_rejects_duplicate_ids(valid_landmarks: np.ndarray) -> None:
    doc = _document(valid_landmarks)
    doc["moves"].append(copy.deepcopy(doc["moves"][0]))
    with pytest.raises(ValueError, match="unique"):
        validate_dance(doc)


def test_semantic_chart_rejects_invalid_window(valid_landmarks: np.ndarray) -> None:
    doc = _document(valid_landmarks)
    doc["moves"][0]["start"] = 0.8
    doc["moves"][0]["end"] = 0.2
    with pytest.raises(ValueError, match="start < end"):
        validate_dance(doc)


def test_semantic_chart_rejects_invisible_target(valid_landmarks: np.ndarray) -> None:
    doc = _document(valid_landmarks)
    doc["moves"][0]["keyframe_landmarks"] = np.zeros((33, 4)).tolist()
    with pytest.raises(ValueError, match="usable visible"):
        validate_dance(doc)


def test_writer_never_serializes_nan(
    tmp_path: Path, valid_landmarks: np.ndarray
) -> None:
    doc = _document(valid_landmarks)
    doc["moves"][0]["keyframe_landmarks"][0][0] = float("nan")
    with pytest.raises(ValueError):
        write_dance_json(doc, tmp_path / "dance.json")
    assert not (tmp_path / "dance.json").exists()
