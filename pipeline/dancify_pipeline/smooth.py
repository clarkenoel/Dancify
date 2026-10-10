"""Savitzky–Golay joint smoothing."""

from __future__ import annotations

import numpy as np
from scipy.signal import savgol_filter


def smooth_landmarks(
    frames: np.ndarray,
    window: int = 9,
    poly: int = 2,
) -> np.ndarray:
    """Smooth xyz over time; leave visibility untouched.

    frames: (T, 33, 4)
    """
    t = frames.shape[0]
    if t < 5:
        return frames.copy()
    # window must be odd and <= T
    w = min(window, t if t % 2 == 1 else t - 1)
    if w < 3:
        return frames.copy()
    if w % 2 == 0:
        w -= 1
    poly = min(poly, w - 1)

    out = frames.copy()
    for joint in range(frames.shape[1]):
        for axis in range(3):
            out[:, joint, axis] = savgol_filter(
                frames[:, joint, axis], window_length=w, polyorder=poly, mode="interp"
            )
    return out
