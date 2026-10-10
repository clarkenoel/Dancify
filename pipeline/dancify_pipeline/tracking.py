"""Tracking validity, short-gap interpolation, and quality gates."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

VISIBILITY_THRESHOLD = 0.35
TORSO_IDX = np.asarray([11, 12, 23, 24], dtype=np.int64)
SCORE_IDX = np.asarray(
    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
    dtype=np.int64,
)


class TrackingQualityError(RuntimeError):
    """The input is not stable enough for the solo-dancer MVP."""

    def __init__(self, message: str, evaluation: "TrackingEvaluation") -> None:
        super().__init__(message)
        self.evaluation = evaluation


@dataclass(frozen=True)
class TrackingStats:
    valid_frame_ratio: float
    valid_frames: int
    total_frames: int
    longest_invalid_seconds: float
    trailing_invalid_seconds: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True)
class InvalidRun:
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    duration_seconds: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True)
class TrackingEvaluation:
    stats: TrackingStats
    valid: bool
    failure_code: str | None
    message: str | None
    invalid_runs: tuple[InvalidRun, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            **self.stats.to_dict(),
            "valid": self.valid,
            "failure_code": self.failure_code,
            "message": self.message,
            "invalid_runs": [run.to_dict() for run in self.invalid_runs],
        }


def joint_validity(
    frames: np.ndarray,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
) -> np.ndarray:
    """Return a `(T, 33)` mask for finite, sufficiently visible joints."""
    xyz_finite = np.all(np.isfinite(frames[:, :, :3]), axis=2)
    visibility = frames[:, :, 3]
    return xyz_finite & np.isfinite(visibility) & (visibility >= visibility_threshold)


def frame_confidence(frames: np.ndarray) -> np.ndarray:
    """Mean confidence of gameplay joints, with missing values treated as zero."""
    visibility = np.nan_to_num(
        frames[:, SCORE_IDX, 3], nan=0.0, posinf=0.0, neginf=0.0
    )
    return np.clip(np.mean(visibility, axis=1), 0.0, 1.0)


def frame_tracking_mask(
    frames: np.ndarray,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
    min_visible_joints: int = 6,
) -> np.ndarray:
    """Require a visible torso and enough visible gameplay joints per frame."""
    valid = joint_validity(frames, visibility_threshold)
    torso_ok = np.all(valid[:, TORSO_IDX], axis=1)
    enough_joints = np.sum(valid[:, SCORE_IDX], axis=1) >= min_visible_joints
    return torso_ok & enough_joints


def frame_tracking_breakdown(
    frames: np.ndarray,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
    min_visible_joints: int = 6,
) -> dict[str, np.ndarray]:
    """Explain every frame-level tracking decision without changing the gate."""
    valid_joints = joint_validity(frames, visibility_threshold)
    xyz_finite = np.all(np.isfinite(frames[:, :, :3]), axis=2)
    has_detection = np.any(xyz_finite, axis=1)
    torso_ok = np.all(valid_joints[:, TORSO_IDX], axis=1)
    visible_score_joints = np.sum(valid_joints[:, SCORE_IDX], axis=1)
    enough_joints = visible_score_joints >= min_visible_joints
    return {
        "has_detection": has_detection,
        "torso_ok": torso_ok,
        "visible_score_joints": visible_score_joints,
        "enough_joints": enough_joints,
        "frame_valid": has_detection & torso_ok & enough_joints,
    }


def frame_failure_reasons(
    index: int, breakdown: dict[str, np.ndarray]
) -> list[str]:
    reasons: list[str] = []
    if not bool(breakdown["has_detection"][index]):
        reasons.append("no_detection")
    if not bool(breakdown["torso_ok"][index]):
        reasons.append("torso_invalid")
    if not bool(breakdown["enough_joints"][index]):
        reasons.append("insufficient_visible_joints")
    return reasons


def interpolate_short_gaps(
    frames: np.ndarray,
    max_gap_frames: int = 3,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
) -> np.ndarray:
    """Linearly fill only short, internally bounded per-joint tracking gaps."""
    out = frames.astype(np.float64).copy()
    if max_gap_frames <= 0 or len(out) < 3:
        return out

    valid = joint_validity(out, visibility_threshold)
    for joint in range(out.shape[1]):
        i = 0
        while i < len(out):
            if valid[i, joint]:
                i += 1
                continue
            start = i
            while i < len(out) and not valid[i, joint]:
                i += 1
            end = i
            gap = end - start
            if (
                gap <= max_gap_frames
                and start > 0
                and end < len(out)
                and valid[start - 1, joint]
                and valid[end, joint]
            ):
                left = out[start - 1, joint]
                right = out[end, joint]
                for offset, frame_idx in enumerate(range(start, end), start=1):
                    alpha = offset / (gap + 1)
                    out[frame_idx, joint] = (1.0 - alpha) * left + alpha * right
    return out


def invalid_tracking_runs(
    times: np.ndarray, valid: np.ndarray
) -> tuple[InvalidRun, ...]:
    if len(times) == 0:
        return ()
    dt = float(np.median(np.diff(times))) if len(times) > 1 else 0.0
    runs: list[InvalidRun] = []
    i = 0
    while i < len(valid):
        if valid[i]:
            i += 1
            continue
        start = i
        while i < len(valid) and not valid[i]:
            i += 1
        end = i - 1
        runs.append(
            InvalidRun(
                start_frame=start,
                end_frame=end,
                start_time=float(times[start]),
                end_time=float(times[end]),
                duration_seconds=max(
                    0.0, float(times[end] - times[start] + dt)
                ),
            )
        )
    return tuple(runs)


def tracking_stats(times: np.ndarray, valid: np.ndarray) -> TrackingStats:
    if len(times) != len(valid):
        raise ValueError("times and tracking mask must have the same length")
    total = len(valid)
    count = int(np.count_nonzero(valid))
    runs = invalid_tracking_runs(times, valid)
    if count:
        last_valid = int(np.flatnonzero(valid)[-1])
        dt = float(np.median(np.diff(times))) if len(times) > 1 else 0.0
        trailing = max(0.0, float(times[-1] - times[last_valid] + dt))
    elif total:
        trailing = max(
            (run.duration_seconds for run in runs),
            default=0.0,
        )
    else:
        trailing = 0.0
    return TrackingStats(
        valid_frame_ratio=float(count / total) if total else 0.0,
        valid_frames=count,
        total_frames=total,
        longest_invalid_seconds=max(
            (run.duration_seconds for run in runs),
            default=0.0,
        ),
        trailing_invalid_seconds=trailing,
    )


def evaluate_stable_tracking(
    times: np.ndarray,
    valid: np.ndarray,
    *,
    min_valid_ratio: float = 0.5,
    max_invalid_seconds: float = 2.0,
    max_trailing_seconds: float = 2.0,
) -> TrackingEvaluation:
    """Evaluate tracking continuity and retain exact invalid intervals."""
    stats = tracking_stats(times, valid)
    runs = invalid_tracking_runs(times, valid)
    failure_code: str | None = None
    message: str | None = None
    if stats.valid_frames == 0:
        failure_code = "no_usable_frames"
        message = "No usable solo-dancer pose frames were detected"
    elif stats.valid_frame_ratio < min_valid_ratio:
        failure_code = "low_valid_frame_ratio"
        message = (
            "Unstable solo-dancer tracking: "
            f"{stats.valid_frame_ratio:.0%} usable frames (need {min_valid_ratio:.0%})"
        )
    elif stats.longest_invalid_seconds > max_invalid_seconds:
        failure_code = "long_dropout"
        longest = max(runs, key=lambda run: run.duration_seconds)
        message = (
            "Unstable solo-dancer tracking: "
            f"{stats.longest_invalid_seconds:.2f}s continuous dropout "
            f"at {longest.start_time:.2f}-{longest.end_time:.2f}s"
        )
    elif stats.trailing_invalid_seconds > max_trailing_seconds:
        failure_code = "trailing_dropout"
        message = (
            "Tracking ends before the media: "
            f"{stats.trailing_invalid_seconds:.2f}s invalid tail"
        )
    return TrackingEvaluation(
        stats=stats,
        valid=failure_code is None,
        failure_code=failure_code,
        message=message,
        invalid_runs=runs,
    )


def require_stable_tracking(
    times: np.ndarray,
    valid: np.ndarray,
    *,
    min_valid_ratio: float = 0.5,
    max_invalid_seconds: float = 2.0,
    max_trailing_seconds: float = 2.0,
) -> TrackingStats:
    """Reject missing or unstable solo-subject tracking."""
    evaluation = evaluate_stable_tracking(
        times,
        valid,
        min_valid_ratio=min_valid_ratio,
        max_invalid_seconds=max_invalid_seconds,
        max_trailing_seconds=max_trailing_seconds,
    )
    if not evaluation.valid:
        raise TrackingQualityError(evaluation.message or "Tracking failed", evaluation)
    return evaluation.stats


def usable_keyframe(
    landmarks: np.ndarray,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
    min_visible_joints: int = 6,
) -> bool:
    """Whether a normalized frame is safe to serialize as a scoring target."""
    if landmarks.shape != (33, 4) or not np.all(np.isfinite(landmarks)):
        return False
    visible = landmarks[SCORE_IDX, 3] >= visibility_threshold
    if int(np.count_nonzero(visible)) < min_visible_joints:
        return False
    visible_xyz = landmarks[SCORE_IDX[visible], :3]
    return not np.allclose(visible_xyz, 0.0, atol=1e-8)
