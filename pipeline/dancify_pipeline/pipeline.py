"""Orchestrate video → dance.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .audio import extract_audio
from .beats import track_beats
from .energy import motion_energy
from .hits import build_moves, select_musical_hits
from .ingest import resolve_input, video_duration_seconds
from .normalize import normalize_sequence
from .pose import extract_poses
from .schema_io import write_dance_json
from .smooth import smooth_landmarks
from .tracking import (
    frame_confidence,
    frame_tracking_mask,
    interpolate_short_gaps,
    require_stable_tracking,
)


def run_pipeline(
    input_path: str,
    output_json: Path,
    work_dir: Path | None = None,
    target_fps: float = 30.0,
    save_audio: Path | None = None,
    fallback_bpm: float | None = None,
    fallback_downbeat: float | None = None,
) -> dict[str, Any]:
    work_dir = Path(work_dir or (Path(output_json).parent / "_work"))
    work_dir.mkdir(parents=True, exist_ok=True)

    video = resolve_input(input_path, work_dir)
    duration = video_duration_seconds(video)

    audio_path = Path(save_audio) if save_audio else work_dir / "audio.wav"
    extract_audio(video, audio_path, video_duration=duration)
    timing = track_beats(
        audio_path,
        fallback_bpm=fallback_bpm,
        fallback_downbeat=fallback_downbeat,
    )

    times, raw, raw_frame_valid, raw_confidence = extract_poses(
        video, target_fps=target_fps
    )
    max_gap_frames = max(1, int(round(target_fps * 0.1)))
    interpolated = interpolate_short_gaps(raw, max_gap_frames=max_gap_frames)
    smoothed = smooth_landmarks(interpolated)
    frame_valid = frame_tracking_mask(smoothed)
    confidence = frame_confidence(smoothed)
    tracking = require_stable_tracking(times, frame_valid)
    normalized = normalize_sequence(smoothed)

    energy = motion_energy(normalized, times, frame_valid=frame_valid)
    hits, key_idxs = select_musical_hits(
        energy,
        times,
        timing.beat_times,
        duration,
        timing.bpm,
        target_beats_per_hit=2.0,
        frame_valid=frame_valid,
    )
    moves = build_moves(
        hits,
        normalized,
        times,
        duration,
        keyframe_indices=key_idxs,
        frame_valid=frame_valid,
    )
    if not moves:
        raise RuntimeError(
            "No usable motion hits found; reject flat, missing, or unstable motion"
        )

    chart_duration = round(float(duration), 4)
    rounded_beats: list[float] = []
    for beat in timing.beat_times:
        rounded = round(float(beat), 4)
        if rounded > chart_duration:
            continue
        if not rounded_beats or rounded > rounded_beats[-1]:
            rounded_beats.append(rounded)
    doc: dict[str, Any] = {
        "version": "1.0",
        "bpm": round(float(timing.bpm), 3),
        "beat_times": rounded_beats,
        "duration": chart_duration,
        "moves": moves,
    }
    write_dance_json(doc, output_json)

    report_path = Path(output_json).with_name(f"{Path(output_json).stem}.report.json")
    report = {
        "version": "1.0",
        "chart": str(Path(output_json)),
        "timing": timing.to_report(),
        "tracking": tracking.to_dict(),
        "readiness": {
            "cache_ready_by_default": not timing.synthetic,
            "synthetic_timing": timing.synthetic,
            "solo_cfr_mvp": True,
        },
    }
    report_path.write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )

    # Persist debug arrays beside work dir for velocity plot
    np.savez(
        work_dir / "debug_arrays.npz",
        times=times,
        energy=energy,
        hits=hits,
        keyframe_indices=key_idxs,
        beat_times=np.asarray(timing.beat_times, dtype=float),
        raw=raw,
        interpolated=interpolated,
        smoothed=smoothed,
        raw_frame_valid=raw_frame_valid,
        raw_frame_confidence=raw_confidence,
        frame_valid=frame_valid,
        frame_confidence=confidence,
    )

    return {
        "doc": doc,
        "video": str(video),
        "audio": str(audio_path),
        "work_dir": str(work_dir),
        "report": str(report_path),
        "move_count": len(moves),
        "bpm": timing.bpm,
        "synthetic_timing": timing.synthetic,
        "cache_ready_by_default": not timing.synthetic,
    }
