from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import dancify_pipeline.pipeline as pipeline_module
from dancify_pipeline.beats import BeatTrack


def test_pipeline_writes_synthetic_readiness_sidecar(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    valid_landmarks: np.ndarray,
) -> None:
    video = tmp_path / "video.mp4"
    video.touch()
    output = tmp_path / "dance.json"
    times = np.arange(90) / 30.0
    frames = np.stack([valid_landmarks.copy() for _ in times])
    frames[:, 15, 0] += 0.1 * np.sin(times * np.pi)
    valid = np.ones(len(times), dtype=bool)
    confidence = np.full(len(times), 0.95)

    monkeypatch.setattr(
        pipeline_module, "resolve_input", lambda *_args, **_kwargs: video
    )
    monkeypatch.setattr(
        pipeline_module, "video_duration_seconds", lambda _path: 3.0
    )
    monkeypatch.setattr(
        pipeline_module,
        "extract_audio",
        lambda _video, path, **_kwargs: Path(path).write_bytes(b"wav"),
    )
    monkeypatch.setattr(
        pipeline_module,
        "track_beats",
        lambda *_args, **_kwargs: BeatTrack(
            bpm=120.0,
            beat_times=[i * 0.5 for i in range(7)],
            source="explicit_fallback",
            synthetic=True,
            downbeat=0.0,
            reason="Audio is silent",
        ),
    )
    monkeypatch.setattr(
        pipeline_module,
        "extract_poses",
        lambda *_args, **_kwargs: (times, frames, valid, confidence),
    )
    monkeypatch.setattr(
        pipeline_module,
        "select_musical_hits",
        lambda *_args, **_kwargs: (np.asarray([1.0]), np.asarray([30])),
    )

    result = pipeline_module.run_pipeline(
        str(video),
        output,
        work_dir=tmp_path / "work",
        fallback_bpm=120.0,
        fallback_downbeat=0.0,
    )

    report = json.loads(Path(result["report"]).read_text(encoding="utf-8"))
    assert result["synthetic_timing"] is True
    assert result["cache_ready_by_default"] is False
    assert report["timing"]["source"] == "explicit_fallback"
    assert report["readiness"]["cache_ready_by_default"] is False
    assert json.loads(output.read_text(encoding="utf-8"))["version"] == "1.0"
