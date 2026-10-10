"""Orchestrate video → dance.json."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .audio import extract_audio
from .beats import track_beats
from .energy import motion_energy
from .hits import build_moves, find_energy_dips, snap_to_beats
from .ingest import resolve_input, video_duration_seconds
from .normalize import normalize_sequence
from .pose import extract_poses
from .schema_io import write_dance_json
from .smooth import smooth_landmarks


def run_pipeline(
    input_path: str,
    output_json: Path,
    work_dir: Path | None = None,
    target_fps: float = 30.0,
    save_audio: Path | None = None,
) -> dict[str, Any]:
    work_dir = Path(work_dir or (Path(output_json).parent / "_work"))
    work_dir.mkdir(parents=True, exist_ok=True)

    video = resolve_input(input_path, work_dir)
    duration = video_duration_seconds(video)

    audio_path = Path(save_audio) if save_audio else work_dir / "audio.wav"
    extract_audio(video, audio_path)
    bpm, beat_times = track_beats(audio_path)

    times, raw = extract_poses(video, target_fps=target_fps)
    smoothed = smooth_landmarks(raw)
    normalized = normalize_sequence(smoothed)

    energy = motion_energy(normalized, times)
    dips = find_energy_dips(energy, times)
    hits = snap_to_beats(dips, beat_times, half_beats=True)
    # ensure at least a few hits for short clips
    if hits.size == 0 and beat_times:
        # fallback: every other beat in the middle of the clip
        mid = [t for t in beat_times if 0.5 < t < duration - 0.3]
        hits = snap_to_beats(
            np.asarray(mid[::2], dtype=float), beat_times, half_beats=False
        )

    moves = build_moves(hits, normalized, times, duration)

    doc: dict[str, Any] = {
        "version": "1.0",
        "bpm": round(float(bpm), 3),
        "beat_times": [round(float(t), 4) for t in beat_times],
        "duration": round(float(duration), 4),
        "moves": moves,
    }
    write_dance_json(doc, output_json)

    # Persist debug arrays beside work dir for velocity plot
    np.savez(
        work_dir / "debug_arrays.npz",
        times=times,
        energy=energy,
        hits=hits,
        beat_times=np.asarray(beat_times, dtype=float),
        raw=raw,
        smoothed=smoothed,
    )

    return {
        "doc": doc,
        "video": str(video),
        "audio": str(audio_path),
        "work_dir": str(work_dir),
        "move_count": len(moves),
        "bpm": bpm,
    }
