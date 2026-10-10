"""Per-frame motion energy (weighted landmark velocity)."""

from __future__ import annotations

import numpy as np

from .tracking import SCORE_IDX, VISIBILITY_THRESHOLD

# Weight groups: arms > legs > face/torso
ARM_IDX = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
LEG_IDX = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
FACE_IDX = list(range(0, 11))


def _weights() -> np.ndarray:
    w = np.ones(33, dtype=np.float64) * 0.5
    for i in FACE_IDX:
        w[i] = 0.25
    for i in LEG_IDX:
        w[i] = 1.0
    for i in ARM_IDX:
        w[i] = 2.0
    return w


def motion_energy(
    frames: np.ndarray,
    times: np.ndarray,
    frame_valid: np.ndarray | None = None,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
) -> np.ndarray:
    """Visibility-masked weighted mean joint speed.

    Invalid frames/transitions are represented as NaN so hit detection cannot
    mistake tracking loss for a held pose.
    """
    w = _weights()
    t = frames.shape[0]
    energy = np.full(t, np.nan, dtype=np.float64)
    if t < 2:
        return energy
    if frame_valid is None:
        frame_valid = np.ones(t, dtype=bool)

    for i in range(1, t):
        dt = float(times[i] - times[i - 1])
        if dt <= 1e-6 or not frame_valid[i - 1] or not frame_valid[i]:
            continue
        pair = frames[i - 1 : i + 1]
        joint_valid = (
            np.all(np.isfinite(pair[:, :, :3]), axis=(0, 2))
            & np.all(np.isfinite(pair[:, :, 3]), axis=0)
            & np.all(pair[:, :, 3] >= visibility_threshold, axis=0)
        )
        if int(np.count_nonzero(joint_valid[SCORE_IDX])) < 6:
            continue
        vel = np.linalg.norm(frames[i, :, :3] - frames[i - 1, :, :3], axis=1) / dt
        active_weights = w[joint_valid]
        energy[i] = float(np.sum(vel[joint_valid] * active_weights) / active_weights.sum())

    finite = np.flatnonzero(np.isfinite(energy))
    if finite.size and finite[0] == 1:
        energy[0] = energy[1]
    return energy
