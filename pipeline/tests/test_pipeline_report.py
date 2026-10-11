from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import dancify_pipeline.pipeline as pipeline_module
from dancify_pipeline.beats import BeatTrack
from dancify_pipeline.tracking import TrackingQualityError


@pytest.mark.parametrize("hidden", ["none", "some", "all"])
def test_pipeline_writes_synthetic_readiness_sidecar(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    valid_landmarks: np.ndarray,
    hidden: str,
) -> None:
    video = tmp_path / "video.mp4"
    video.touch()
    output = tmp_path / "dance.json"
    times = np.arange(90) / 30.0
    frames = np.stack([valid_landmarks.copy() for _ in times])
    frames[:, 15, 0] += 0.1 * np.sin(times * np.pi)
    if hidden == "some":
        frames[20:40, 15, 3] = 0
    elif hidden == "all":
        frames[:, 15, 3] = 0
    valid = np.ones(len(times), dtype=bool)
    confidence = np.full(len(times), 0.95)

    monkeypatch.setattr(
        pipeline_module, "resolve_input", lambda *_args, **_kwargs: video
    )
    monkeypatch.setattr(
        pipeline_module, "video_duration_seconds", lambda _path: 3.0
    )
    monkeypatch.setattr(
        pipeline_module, "video_aspect_ratio", lambda _path: 16 / 9
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
        lambda *_args, **_kwargs: (np.asarray([1.0, 2.0]), np.asarray([30, 60])),
    )

    if hidden == "all":
        with pytest.raises(RuntimeError, match="No usable motion hits"):
            pipeline_module.run_pipeline(str(video), output, work_dir=tmp_path / "work", fallback_bpm=120, fallback_downbeat=0)
        assert not output.exists()
        return

    result = pipeline_module.run_pipeline(
        str(video),
        output,
        work_dir=tmp_path / "work",
        fallback_bpm=120.0,
        fallback_downbeat=0.0,
    )

    report = json.loads(Path(result["report"]).read_text(encoding="utf-8"))
    assert report["checkpoint_quality"] == {"selected": 2, "retained": 1 if hidden == "some" else 2, "omitted": 1 if hidden == "some" else 0}
    assert result["synthetic_timing"] is True
    assert result["cache_ready_by_default"] is False
    assert report["timing"]["source"] == "explicit_fallback"
    assert report["readiness"]["cache_ready_by_default"] is False
    assert json.loads(output.read_text(encoding="utf-8"))["version"] == "1.0"


def test_pipeline_persists_diagnostics_before_tracking_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    valid_landmarks: np.ndarray,
) -> None:
    video = tmp_path / "video.mp4"
    video.touch()
    output = tmp_path / "dance.json"
    times = np.arange(180) / 30.0
    frames = np.stack([valid_landmarks.copy() for _ in times])
    frames[30:96, :, :3] = np.nan
    frames[30:96, :, 3] = 0.0
    valid = np.ones(len(times), dtype=bool)
    valid[30:96] = False
    confidence = np.where(valid, 0.95, 0.0)

    monkeypatch.setattr(
        pipeline_module, "resolve_input", lambda *_args, **_kwargs: video
    )
    monkeypatch.setattr(
        pipeline_module, "video_duration_seconds", lambda _path: 6.0
    )
    monkeypatch.setattr(
        pipeline_module, "video_aspect_ratio", lambda _path: 16 / 9
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
            beat_times=[i * 0.5 for i in range(13)],
            source="audio",
            synthetic=False,
            downbeat=0.0,
            reason=None,
        ),
    )
    monkeypatch.setattr(
        pipeline_module,
        "extract_poses",
        lambda *_args, **_kwargs: (times, frames, valid, confidence),
    )
    monkeypatch.setattr(
        pipeline_module,
        "render_tracking_video",
        lambda _video, path, **_kwargs: Path(path).write_bytes(b"video"),
    )

    with pytest.raises(TrackingQualityError, match="1.00-3.17s"):
        pipeline_module.run_pipeline(
            str(video),
            output,
            work_dir=tmp_path / "work",
        )

    report = json.loads(
        (tmp_path / "dance.report.json").read_text(encoding="utf-8")
    )
    tracking = json.loads(
        (tmp_path / "dance.tracking.json").read_text(encoding="utf-8")
    )
    assert report["status"] == "failed"
    assert report["tracking"]["failure_code"] == "long_dropout"
    assert report["diagnostics"]["video"].endswith("dance.tracking.mp4")
    assert tracking["tracking"]["invalid_runs"][0]["start_time"] == pytest.approx(
        1.0
    )
    assert (tmp_path / "work" / "debug_arrays.npz").is_file()
    assert not output.exists()
