"""Per-frame motion energy (weighted landmark velocity)."""

from __future__ import annotations

import numpy as np

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


def motion_energy(frames: np.ndarray, times: np.ndarray) -> np.ndarray:
    """Weighted mean joint speed. frames (T,33,4), times (T,) → energy (T,)."""
    w = _weights()
    t = frames.shape[0]
    energy = np.zeros(t, dtype=np.float64)
    if t < 2:
        return energy
    dt = np.diff(times)
    dt[dt < 1e-6] = 1e-6
    vel = np.linalg.norm(np.diff(frames[:, :, :3], axis=0), axis=2) / dt[:, None]
    # vel (T-1, 33)
    weighted = (vel * w[None, :]).sum(axis=1) / w.sum()
    energy[1:] = weighted
    energy[0] = energy[1]
    return energy
