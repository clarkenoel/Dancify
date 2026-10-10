from __future__ import annotations

from pathlib import Path

import pytest

import main as pipeline_main
from dancify_pipeline import cache


class FakeResponse:
    def __init__(self, status_code: int, text: str = "", payload: dict | None = None):
        self.status_code = status_code
        self.text = text
        self._payload = payload or {}

    def json(self) -> dict:
        return self._payload


def test_mark_processing_raises_on_http_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        cache.requests,
        "patch",
        lambda *_args, **_kwargs: FakeResponse(404, "missing"),
    )
    with pytest.raises(RuntimeError, match="404"):
        cache.mark_processing("missing")


def test_cli_fails_before_pipeline_when_cache_state_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        pipeline_main,
        "mark_processing",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("404")),
    )
    called = False

    def fake_pipeline(**_kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(pipeline_main, "run_pipeline", fake_pipeline)
    result = pipeline_main.main(
        ["--input", "video.mp4", "--output", str(tmp_path / "dance.json"), "--song-id", "x"]
    )
    assert result == 2
    assert called is False


def _pipeline_result(tmp_path: Path, *, synthetic: bool) -> dict:
    return {
        "bpm": 120.0,
        "move_count": 4,
        "audio": str(tmp_path / "audio.wav"),
        "report": str(tmp_path / "dance.report.json"),
        "synthetic_timing": synthetic,
        "cache_ready_by_default": not synthetic,
    }


def test_upload_failure_marks_song_failed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failed: list[str] = []
    monkeypatch.setattr(pipeline_main, "mark_processing", lambda *_args: None)
    monkeypatch.setattr(
        pipeline_main,
        "run_pipeline",
        lambda **_kwargs: _pipeline_result(tmp_path, synthetic=False),
    )
    monkeypatch.setattr(
        pipeline_main,
        "upload_chart",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("PUT 500")),
    )
    monkeypatch.setattr(
        pipeline_main,
        "mark_failed",
        lambda _song_id, message, _base_url: failed.append(message),
    )

    result = pipeline_main.main(
        ["--input", "video.mp4", "--output", str(tmp_path / "dance.json"), "--song-id", "x"]
    )

    assert result == 2
    assert failed == ["PUT 500"]


def test_synthetic_timing_is_not_cached_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failed: list[str] = []
    uploaded = False
    monkeypatch.setattr(pipeline_main, "mark_processing", lambda *_args: None)
    monkeypatch.setattr(
        pipeline_main,
        "run_pipeline",
        lambda **_kwargs: _pipeline_result(tmp_path, synthetic=True),
    )
    monkeypatch.setattr(
        pipeline_main,
        "mark_failed",
        lambda _song_id, message, _base_url: failed.append(message),
    )

    def fake_upload(*_args, **_kwargs):
        nonlocal uploaded
        uploaded = True

    monkeypatch.setattr(pipeline_main, "upload_chart", fake_upload)
    result = pipeline_main.main(
        [
            "--input",
            "video.mp4",
            "--output",
            str(tmp_path / "dance.json"),
            "--song-id",
            "x",
        ]
    )

    assert result == 2
    assert uploaded is False
    assert "synthetic timing" in failed[0]
