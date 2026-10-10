"""MediaPipe Pose extraction at ~target_fps."""

from __future__ import annotations

from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from .tracking import frame_confidence, frame_tracking_mask


def extract_poses(
    video_path: Path,
    target_fps: float = 30.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return timestamps, landmarks, frame-valid mask, and confidence.

    This is deliberately a solo-subject MVP. Inputs with multiple people are
    unsupported; downstream continuity gates reject unstable tracking.
    """
    if not np.isfinite(target_fps) or target_fps <= 0:
        raise ValueError("target_fps must be a finite positive number")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(round(src_fps / target_fps)))

    mp_pose = mp.solutions.pose
    times: list[float] = []
    frames: list[np.ndarray] = []

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        idx = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if idx % frame_interval != 0:
                idx += 1
                continue
            pts = float(cap.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
            t = pts if np.isfinite(pts) and pts > 0 else idx / src_fps
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)
            lm = np.full((33, 4), np.nan, dtype=np.float64)
            lm[:, 3] = 0.0
            if result.pose_landmarks:
                for i, p in enumerate(result.pose_landmarks.landmark):
                    lm[i] = [p.x, p.y, p.z, p.visibility]
            times.append(t)
            frames.append(lm)
            idx += 1

    cap.release()
    if not frames:
        raise RuntimeError("No frames read from video")
    timestamps = np.asarray(times, dtype=np.float64)
    landmarks = np.stack(frames, axis=0)
    return (
        timestamps,
        landmarks,
        frame_tracking_mask(landmarks),
        frame_confidence(landmarks),
    )
