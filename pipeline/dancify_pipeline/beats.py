"""BPM + beat times via librosa, on the video timeline."""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np


def _synthetic_beats(duration: float, bpm: float) -> list[float]:
    """Uniform beat grid when audio is silent / beat_track finds nothing."""
    if duration <= 0:
        return []
    period = 60.0 / bpm
    # Start on the downbeat at t=0 (video timeline).
    times = np.arange(0.0, duration + 1e-9, period)
    return times.astype(float).tolist()


def track_beats(audio_path: Path, sr: int = 22050) -> tuple[float, list[float]]:
    """Return (bpm, beat_times_seconds) aligned to audio/video start = 0."""
    y, file_sr = librosa.load(str(audio_path), sr=sr, mono=True)
    duration = float(len(y) / file_sr) if file_sr else 0.0
    rms = float(np.sqrt(np.mean(np.square(y)))) if y.size else 0.0

    # Mute / silence sidecar (JD UI rips with no audio stream).
    if y.size == 0 or rms < 1e-6:
        bpm = 120.0
        return bpm, _synthetic_beats(duration, bpm)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=file_sr)
    # librosa >=0.10 may return tempo as ndarray
    if isinstance(tempo, np.ndarray):
        bpm = float(tempo.item() if tempo.size == 1 else tempo.flat[0])
    else:
        bpm = float(tempo)
    beat_times = librosa.frames_to_time(beat_frames, sr=file_sr).astype(float).tolist()
    if bpm <= 0:
        bpm = 120.0
    if not beat_times:
        beat_times = _synthetic_beats(duration, bpm)
    return bpm, beat_times
