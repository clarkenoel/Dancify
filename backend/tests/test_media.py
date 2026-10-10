from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.media import MediaValidationError, validate_bundle_media


def _run(command: list[str]) -> None:
    process = subprocess.run(command, capture_output=True, text=True, check=False)
    assert process.returncode == 0, process.stderr


def _make_media(tmp_path: Path) -> tuple[Path, Path]:
    video = tmp_path / "video.mp4"
    audio = tmp_path / "audio.wav"
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x90:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=22050:duration=1",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-shortest",
            str(video),
        ]
    )
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i",
            str(video),
            "-map",
            "0:a:0",
            "-c:a",
            "pcm_s16le",
            str(audio),
        ]
    )
    return video, audio


def test_ffprobe_accepts_browser_media_with_aligned_durations(
    tmp_path: Path,
) -> None:
    video, audio = _make_media(tmp_path)

    result = validate_bundle_media(video, audio, 1.0)

    assert result["container"] == "mp4"
    assert result["video_codec"] == "h264"
    assert result["audio_codec"] == "aac"
    assert result["duration"] > 0


def test_ffprobe_rejects_duration_drift(tmp_path: Path) -> None:
    video, audio = _make_media(tmp_path)

    with pytest.raises(MediaValidationError, match="does not align"):
        validate_bundle_media(video, audio, 2.0)


def test_ffprobe_rejects_missing_embedded_audio(tmp_path: Path) -> None:
    _, audio = _make_media(tmp_path)
    mute_video = tmp_path / "mute.mp4"
    _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x90:r=10:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(mute_video),
        ]
    )

    with pytest.raises(MediaValidationError, match="audio stream"):
        validate_bundle_media(mute_video, audio, 1.0)
