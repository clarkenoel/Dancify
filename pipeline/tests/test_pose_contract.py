from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from dancify_pipeline.normalize import normalize_frame

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "pose-normalization.json"
)


def _expand(default: list[float], overrides: dict[str, list[float]]) -> np.ndarray:
    landmarks = np.asarray([default[:] for _ in range(33)], dtype=np.float64)
    for index, value in overrides.items():
        landmarks[int(index)] = value
    return landmarks


@pytest.mark.parametrize("case_index", [0, 1])
def test_pose_normalization_matches_browser_fixture(case_index: int) -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    case = payload["cases"][case_index]
    raw = _expand(case["default_landmark"], case["raw_overrides"])
    expected = _expand(
        case["expected_default"],
        case["expected_overrides"],
    )

    actual = normalize_frame(
        raw,
        aspect_ratio=float(case["frame"]["aspect_ratio"]),
    )

    assert np.allclose(actual, expected, atol=1e-6)


def test_near_zero_torso_returns_non_comparable_pose() -> None:
    landmarks = np.zeros((33, 4), dtype=np.float64)
    landmarks[:, 3] = 0.95
    landmarks[11, :3] = [0.5, 0.5, 0.0]
    landmarks[12, :3] = [0.5, 0.5, 0.0]
    landmarks[23, :3] = [0.5, 0.5, 0.0]
    landmarks[24, :3] = [0.5, 0.5, 0.0]

    normalized = normalize_frame(landmarks, aspect_ratio=16 / 9)

    assert np.isnan(normalized[:, :3]).all()
