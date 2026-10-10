"""Extract audio from video without changing speed (timeline = video.currentTime)."""

from __future__ import annotations

import subprocess
from pathlib import Path


def extract_audio(video_path: Path, audio_path: Path, sample_rate: int = 22050) -> Path:
    """Write mono WAV at `sample_rate` using ffmpeg. Duration matches video timeline."""
    audio_path = Path(audio_path)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(audio_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extract failed:\n{proc.stderr[-2000:]}")
    if not audio_path.is_file():
        raise RuntimeError(f"ffmpeg did not write {audio_path}")
    return audio_path
