"""Hip-center + torso-scale landmark normalization (handshake with web)."""

from __future__ import annotations

import numpy as np

# MediaPipe Pose landmark indices
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24


def normalize_frame(landmarks: np.ndarray) -> np.ndarray:
    """Normalize one frame of shape (33, 4) → hip-center origin, torso-length scale.

    landmarks columns: x, y, z, visibility (visibility is not scaled).
    """
    out = landmarks.astype(np.float64).copy()
    hip = 0.5 * (out[LEFT_HIP, :3] + out[RIGHT_HIP, :3])
    shoulder = 0.5 * (out[LEFT_SHOULDER, :3] + out[RIGHT_SHOULDER, :3])
    torso = float(np.linalg.norm(shoulder - hip))
    if torso < 1e-6:
        torso = 1.0
    out[:, :3] = (out[:, :3] - hip) / torso
    return out


def normalize_sequence(frames: np.ndarray) -> np.ndarray:
    """frames: (T, 33, 4) → same shape, per-frame normalized."""
    return np.stack([normalize_frame(f) for f in frames], axis=0)
