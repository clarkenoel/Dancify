"""Persistent tracking diagnostics for successful and failed pipeline runs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np

from .tracking import (
    TrackingEvaluation,
    frame_failure_reasons,
    frame_tracking_breakdown,
)


def build_tracking_payload(
    times: np.ndarray,
    raw: np.ndarray,
    interpolated: np.ndarray,
    smoothed: np.ndarray,
    confidence: np.ndarray,
    evaluation: TrackingEvaluation,
) -> dict[str, Any]:
    stages = {
        "raw": frame_tracking_breakdown(raw),
        "interpolated": frame_tracking_breakdown(interpolated),
        "smoothed": frame_tracking_breakdown(smoothed),
    }
    frames: list[dict[str, Any]] = []
    final = stages["smoothed"]
    for index, timestamp in enumerate(times):
        if bool(final["frame_valid"][index]):
            continue
        frames.append(
            {
                "frame": index,
                "time": round(float(timestamp), 6),
                "confidence": round(float(confidence[index]), 6),
                "visible_score_joints": int(
                    final["visible_score_joints"][index]
                ),
                "reasons": frame_failure_reasons(index, final),
                "stage_validity": {
                    name: bool(stage["frame_valid"][index])
                    for name, stage in stages.items()
                },
            }
        )
    return {
        "version": "1.0",
        "tracking": evaluation.to_dict(),
        "invalid_frames": frames,
        "stage_valid_frame_ratios": {
            name: float(np.mean(stage["frame_valid"]))
            for name, stage in stages.items()
        },
    }


def write_tracking_json(path: Path, payload: dict[str, Any]) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return path


def write_partial_debug_arrays(
    path: Path,
    *,
    times: np.ndarray,
    raw: np.ndarray,
    interpolated: np.ndarray,
    smoothed: np.ndarray,
    raw_frame_valid: np.ndarray,
    raw_frame_confidence: np.ndarray,
    frame_valid: np.ndarray,
    frame_confidence: np.ndarray,
) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        times=times,
        raw=raw,
        interpolated=interpolated,
        smoothed=smoothed,
        raw_frame_valid=raw_frame_valid,
        raw_frame_confidence=raw_frame_confidence,
        frame_valid=frame_valid,
        frame_confidence=frame_confidence,
    )
    return path


def _nearest_sample(times: np.ndarray, timestamp: float) -> int:
    index = int(np.searchsorted(times, timestamp))
    if index <= 0:
        return 0
    if index >= len(times):
        return len(times) - 1
    before = index - 1
    return before if abs(times[before] - timestamp) <= abs(times[index] - timestamp) else index


def _draw_pose(
    image: np.ndarray,
    landmarks: np.ndarray,
    *,
    color: tuple[int, int, int],
) -> None:
    height, width = image.shape[:2]

    def point(index: int) -> tuple[int, int] | None:
        x, y, _, visibility = landmarks[index]
        if not np.isfinite([x, y, visibility]).all() or visibility <= 0:
            return None
        return (
            int(np.clip(x, 0.0, 1.0) * (width - 1)),
            int(np.clip(y, 0.0, 1.0) * (height - 1)),
        )

    for start, end in mp.solutions.pose.POSE_CONNECTIONS:
        left = point(start)
        right = point(end)
        if left is not None and right is not None:
            cv2.line(image, left, right, color, 2, cv2.LINE_AA)
    for index in range(len(landmarks)):
        location = point(index)
        if location is not None:
            cv2.circle(image, location, 3, color, -1, cv2.LINE_AA)


def render_tracking_video(
    video_path: Path,
    output_path: Path,
    *,
    times: np.ndarray,
    landmarks: np.ndarray,
    confidence: np.ndarray,
    breakdown: dict[str, np.ndarray],
) -> Path:
    """Render the original video with pose and frame-level gate reasons."""
    video_path = Path(video_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open diagnostic source: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        capture.release()
        raise RuntimeError(f"Cannot open diagnostic output: {output_path}")

    frame_number = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        pts = float(capture.get(cv2.CAP_PROP_POS_MSEC)) / 1000.0
        fallback = frame_number / fps
        timestamp = pts if np.isfinite(pts) and pts >= 0 else fallback
        sample = _nearest_sample(times, timestamp)
        valid = bool(breakdown["frame_valid"][sample])
        color = (40, 190, 40) if valid else (30, 30, 230)
        _draw_pose(frame, landmarks[sample], color=color)

        reasons = frame_failure_reasons(sample, breakdown)
        status = "VALID" if valid else "INVALID: " + ",".join(reasons)
        visible = int(breakdown["visible_score_joints"][sample])
        lines = [
            f"t={timestamp:.2f}s sample={sample} {status}",
            f"joint_confidence={confidence[sample]:.3f} visible_gameplay_joints={visible}",
        ]
        for line_number, text in enumerate(lines):
            y = 32 + line_number * 30
            cv2.putText(
                frame,
                text,
                (18, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                4,
                cv2.LINE_AA,
            )
            cv2.putText(
                frame,
                text,
                (18, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2,
                cv2.LINE_AA,
            )
        writer.write(frame)
        frame_number += 1

    writer.release()
    capture.release()
    return output_path
