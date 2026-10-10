"""Hip-center + torso-scale landmark normalization (handshake with web)."""

from __future__ import annotations

import numpy as np

# MediaPipe Pose landmark indices
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24


def normalize_frame(
    landmarks: np.ndarray, aspect_ratio: float = 1.0
) -> np.ndarray:
    """Normalize one frame of shape (33, 4) → hip-center origin, torso-length scale.

    x/y are MediaPipe image-space coordinates. x and z use image-width units,
    so both are converted to image-height units before 3D normalization.
    Visibility is copied unchanged.
    """
    if not np.isfinite(aspect_ratio) or aspect_ratio <= 0:
        raise ValueError("aspect_ratio must be finite and positive")
    out = landmarks.astype(np.float64).copy()
    out[:, 0] *= aspect_ratio
    out[:, 2] *= aspect_ratio
    hip = 0.5 * (out[LEFT_HIP, :3] + out[RIGHT_HIP, :3])
    shoulder = 0.5 * (out[LEFT_SHOULDER, :3] + out[RIGHT_SHOULDER, :3])
    if not np.all(np.isfinite(hip)) or not np.all(np.isfinite(shoulder)):
        out[:, :3] = np.nan
        return out
    torso = float(np.linalg.norm(shoulder - hip))
    if not np.isfinite(torso) or torso < 1e-6:
        out[:, :3] = np.nan
        return out
    out[:, :3] = (out[:, :3] - hip) / torso
    return out


def normalize_sequence(
    frames: np.ndarray, aspect_ratio: float = 1.0
) -> np.ndarray:
    """frames: (T, 33, 4) → same shape, per-frame normalized."""
    return np.stack(
        [normalize_frame(f, aspect_ratio=aspect_ratio) for f in frames],
        axis=0,
    )
