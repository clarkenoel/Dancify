"""BPM + beat times via librosa, on the video timeline."""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np


def track_beats(audio_path: Path, sr: int = 22050) -> tuple[float, list[float]]:
    """Return (bpm, beat_times_seconds) aligned to audio/video start = 0."""
    y, file_sr = librosa.load(str(audio_path), sr=sr, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=file_sr)
    # librosa >=0.10 may return tempo as ndarray
    if isinstance(tempo, np.ndarray):
        bpm = float(tempo.item() if tempo.size == 1 else tempo.flat[0])
    else:
        bpm = float(tempo)
    beat_times = librosa.frames_to_time(beat_frames, sr=file_sr).astype(float).tolist()
    if bpm <= 0:
        bpm = 120.0
    return bpm, beat_times
