from __future__ import annotations

import numpy as np
import pytest

from dancify_pipeline.smooth import smooth_landmarks
from dancify_pipeline.tracking import (
    TrackingQualityError,
    evaluate_stable_tracking,
    frame_tracking_breakdown,
    frame_tracking_mask,
    invalid_tracking_runs,
    interpolate_short_gaps,
    require_stable_tracking,
    usable_keyframe,
)


def _missing_frame() -> np.ndarray:
    frame = np.full((33, 4), np.nan, dtype=np.float64)
    frame[:, 3] = 0.0
    return frame


def test_no_pose_is_invalid_and_rejected() -> None:
    frames = np.stack([_missing_frame()] * 10)
    valid = frame_tracking_mask(frames)

    assert not valid.any()
    assert not usable_keyframe(frames[0])
    with pytest.raises(TrackingQualityError, match="No usable"):
        require_stable_tracking(np.arange(10) / 30.0, valid)


def test_short_dropout_is_interpolated(valid_landmarks: np.ndarray) -> None:
    frames = np.stack([valid_landmarks.copy() for _ in range(7)])
    frames[3] = _missing_frame()

    repaired = interpolate_short_gaps(frames, max_gap_frames=1)

    assert np.all(np.isfinite(repaired[3]))
    assert frame_tracking_mask(repaired).all()


def test_long_dropout_is_not_smoothed_across(valid_landmarks: np.ndarray) -> None:
    frames = np.stack([valid_landmarks.copy() for _ in range(11)])
    frames[4:7] = _missing_frame()

    repaired = interpolate_short_gaps(frames, max_gap_frames=1)
    smoothed = smooth_landmarks(repaired)

    assert np.isnan(smoothed[4:7, :, :3]).all()
    assert frame_tracking_mask(smoothed).tolist() == [
        True,
        True,
        True,
        True,
        False,
        False,
        False,
        True,
        True,
        True,
        True,
    ]


def test_sustained_dead_tail_fails(valid_landmarks: np.ndarray) -> None:
    frames = np.stack([valid_landmarks.copy() for _ in range(120)])
    frames[45:] = _missing_frame()
    times = np.arange(len(frames)) / 30.0

    with pytest.raises(TrackingQualityError, match="Unstable|ends before"):
        require_stable_tracking(times, frame_tracking_mask(frames))


def test_invalid_runs_include_exact_timestamps() -> None:
    times = np.arange(8) / 10.0
    valid = np.asarray([True, False, False, True, True, False, True, True])

    runs = invalid_tracking_runs(times, valid)

    assert len(runs) == 2
    assert runs[0].start_frame == 1
    assert runs[0].end_frame == 2
    assert runs[0].start_time == pytest.approx(0.1)
    assert runs[0].end_time == pytest.approx(0.2)
    assert runs[0].duration_seconds == pytest.approx(0.2)


def test_evaluation_reports_long_dropout_time_range() -> None:
    times = np.arange(180) / 30.0
    valid = np.ones(180, dtype=bool)
    valid[30:96] = False

    evaluation = evaluate_stable_tracking(times, valid)

    assert evaluation.valid is False
    assert evaluation.failure_code == "long_dropout"
    assert "1.00-3.17s" in (evaluation.message or "")


def test_breakdown_distinguishes_detection_and_visibility(
    valid_landmarks: np.ndarray,
) -> None:
    no_detection = _missing_frame()
    low_visibility = valid_landmarks.copy()
    low_visibility[:, 3] = 0.1
    frames = np.stack([valid_landmarks, no_detection, low_visibility])

    breakdown = frame_tracking_breakdown(frames)

    assert breakdown["frame_valid"].tolist() == [True, False, False]
    assert breakdown["has_detection"].tolist() == [True, False, True]
    assert breakdown["torso_ok"].tolist() == [True, False, False]
