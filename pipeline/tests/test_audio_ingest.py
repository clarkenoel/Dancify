from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from dancify_pipeline.audio import extract_audio
from dancify_pipeline.ingest import download_url


def _duration(path: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(proc.stdout.strip())


@pytest.mark.skipif(
    not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
    reason="ffmpeg/ffprobe required",
)
def test_audio_is_trimmed_to_video_master_timeline(tmp_path: Path) -> None:
    source = tmp_path / "mismatched.mp4"
    output = tmp_path / "audio.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x120:r=30:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=22050:duration=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
    )

    extract_audio(source, output, video_duration=1.0)

    assert _duration(output) == pytest.approx(1.0, abs=0.01)


def test_url_downloads_are_unique_and_replace_stale_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = 0
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_kwargs) -> SimpleNamespace:
        nonlocal calls
        calls += 1
        commands.append(command)
        template = Path(command[command.index("-o") + 1])
        output = Path(str(template).replace("%(ext)s", "mp4"))
        output.write_text(f"{command[-1]}:{calls}", encoding="utf-8")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("dancify_pipeline.ingest.subprocess.run", fake_run)
    destination = tmp_path / "download.mp4"

    first = download_url("https://example.test/one", destination)
    second = download_url("https://example.test/two", destination)
    refreshed = download_url("https://example.test/one", destination)

    assert first != second
    assert refreshed == first
    assert refreshed.read_text(encoding="utf-8").endswith(":3")
    assert all("--force-overwrites" in command for command in commands)
