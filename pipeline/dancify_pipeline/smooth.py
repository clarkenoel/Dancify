"""Savitzky–Golay joint smoothing."""

from __future__ import annotations

import numpy as np
from scipy.signal import savgol_filter

from .tracking import VISIBILITY_THRESHOLD, joint_validity


def smooth_landmarks(
    frames: np.ndarray,
    window: int = 9,
    poly: int = 2,
    visibility_threshold: float = VISIBILITY_THRESHOLD,
) -> np.ndarray:
    """Smooth xyz only within contiguous, valid per-joint runs.

    frames: (T, 33, 4)
    """
    out = frames.astype(np.float64).copy()
    valid = joint_validity(out, visibility_threshold)
    for joint in range(frames.shape[1]):
        i = 0
        while i < len(out):
            if not valid[i, joint]:
                i += 1
                continue
            start = i
            while i < len(out) and valid[i, joint]:
                i += 1
            end = i
            run_length = end - start
            if run_length < 3:
                continue
            w = min(window, run_length if run_length % 2 == 1 else run_length - 1)
            if w < 3:
                continue
            order = min(poly, w - 1)
            for axis in range(3):
                out[start:end, joint, axis] = savgol_filter(
                    out[start:end, joint, axis],
                    window_length=w,
                    polyorder=order,
                    mode="interp",
                )
    return out
