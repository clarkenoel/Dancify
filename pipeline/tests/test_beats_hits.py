from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from dancify_pipeline.beats import ExplicitTimingRequired, track_beats
from dancify_pipeline.hits import build_moves, select_musical_hits, snap_to_beats


def test_mute_audio_requires_explicit_timing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dancify_pipeline.beats.librosa.load",
        lambda *_args, **_kwargs: (np.zeros(22050), 22050),
    )

    with pytest.raises(ExplicitTimingRequired, match="fallback-bpm"):
        track_beats(Path("mute.wav"))


def test_mute_audio_reports_synthetic_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dancify_pipeline.beats.librosa.load",
        lambda *_args, **_kwargs: (np.zeros(44100), 22050),
    )

    result = track_beats(
        Path("mute.wav"), fallback_bpm=120.0, fallback_downbeat=0.25
    )

    assert result.synthetic is True
    assert result.source == "explicit_fallback"
    assert result.beat_times == [0.25, 0.75, 1.25, 1.75]


def test_unusable_motion_returns_no_hits() -> None:
    times = np.arange(0.0, 5.01, 1 / 30)
    energy = np.zeros_like(times)
    hits, keyframes = select_musical_hits(
        energy,
        times,
        [i * 0.5 for i in range(11)],
        duration=5.0,
        bpm=120.0,
        frame_valid=np.ones_like(times, dtype=bool),
    )

    assert hits.size == 0
    assert keyframes.size == 0


def test_no_valley_fallback_uses_every_two_whole_beats() -> None:
    times = np.arange(0.0, 5.01, 1 / 30)
    energy = np.linspace(1.0, 2.0, len(times))
    hits, _ = select_musical_hits(
        energy,
        times,
        [i * 0.5 for i in range(11)],
        duration=5.0,
        bpm=120.0,
        target_beats_per_hit=2.0,
        frame_valid=np.ones_like(times, dtype=bool),
    )

    assert hits.tolist() == [0.5, 1.5, 2.5, 3.5, 4.5]
    assert np.allclose(np.diff(hits), 1.0)


def test_snap_to_half_beat_grid() -> None:
    snapped = snap_to_beats(
        np.asarray([0.24, 0.77, 1.26]),
        [0.0, 0.5, 1.0, 1.5],
        half_beats=True,
    )
    assert np.allclose(snapped, [0.25, 0.75, 1.25])


def test_build_moves_rejects_low_visibility_keyframe(
    valid_landmarks: np.ndarray,
) -> None:
    invalid = valid_landmarks.copy()
    invalid[:, 3] = 0.0
    moves = build_moves(
        np.asarray([0.5]),
        invalid[None, :, :],
        np.asarray([0.5]),
        duration=1.0,
        keyframe_indices=np.asarray([0]),
        frame_valid=np.asarray([True]),
    )
    assert moves == []
