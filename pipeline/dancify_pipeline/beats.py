"""BPM + beat times via librosa, on the video timeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import librosa
import numpy as np


class ExplicitTimingRequired(RuntimeError):
    """Mute or untrackable audio needs explicit synthetic timing."""


@dataclass(frozen=True)
class BeatTrack:
    bpm: float
    beat_times: list[float]
    source: str
    synthetic: bool
    downbeat: float
    reason: str | None = None

    def to_report(self) -> dict:
        return asdict(self)


def _synthetic_beats(duration: float, bpm: float, downbeat: float) -> list[float]:
    """Uniform, explicitly phased grid for mute/untrackable audio."""
    if duration <= 0:
        return []
    if not np.isfinite(bpm) or bpm <= 0:
        raise ValueError("fallback BPM must be a finite positive number")
    if not np.isfinite(downbeat) or downbeat < 0 or downbeat >= duration:
        raise ValueError("fallback downbeat must be within the video timeline")
    period = 60.0 / bpm
    times = np.arange(downbeat, duration + 1e-9, period)
    return times.astype(float).tolist()


def _explicit_fallback(
    duration: float,
    fallback_bpm: float | None,
    fallback_downbeat: float | None,
    reason: str,
) -> BeatTrack:
    if fallback_bpm is None or fallback_downbeat is None:
        raise ExplicitTimingRequired(
            f"{reason}; pass both --fallback-bpm and --fallback-downbeat"
        )
    beats = _synthetic_beats(duration, fallback_bpm, fallback_downbeat)
    return BeatTrack(
        bpm=float(fallback_bpm),
        beat_times=beats,
        source="explicit_fallback",
        synthetic=True,
        downbeat=float(fallback_downbeat),
        reason=reason,
    )


def track_beats(
    audio_path: Path,
    sr: int = 22050,
    *,
    fallback_bpm: float | None = None,
    fallback_downbeat: float | None = None,
) -> BeatTrack:
    """Track audible beats or require an explicit synthetic grid."""
    y, file_sr = librosa.load(str(audio_path), sr=sr, mono=True)
    duration = float(len(y) / file_sr) if file_sr else 0.0
    rms = float(np.sqrt(np.mean(np.square(y)))) if y.size else 0.0

    if y.size == 0 or not np.isfinite(rms) or rms < 1e-6:
        return _explicit_fallback(
            duration, fallback_bpm, fallback_downbeat, "Audio is silent"
        )

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=file_sr)
    # librosa >=0.10 may return tempo as ndarray
    if isinstance(tempo, np.ndarray):
        bpm = float(tempo.item() if tempo.size == 1 else tempo.flat[0])
    else:
        bpm = float(tempo)
    beat_times = librosa.frames_to_time(beat_frames, sr=file_sr).astype(float).tolist()
    beat_times = [t for t in beat_times if np.isfinite(t) and 0 <= t <= duration]
    if not np.isfinite(bpm) or bpm <= 0 or len(beat_times) < 2:
        return _explicit_fallback(
            duration,
            fallback_bpm,
            fallback_downbeat,
            "No reliable beat grid was detected",
        )
    return BeatTrack(
        bpm=bpm,
        beat_times=beat_times,
        source="audio",
        synthetic=False,
        downbeat=float(beat_times[0]),
    )
