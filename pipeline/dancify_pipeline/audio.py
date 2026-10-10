"""Extract audio from video without changing speed (timeline = video.currentTime)."""

from __future__ import annotations

import subprocess
from pathlib import Path


def _video_duration_seconds(video_path: Path) -> float:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise RuntimeError(f"ffprobe failed:\n{probe.stderr[-2000:]}")
    try:
        return float(probe.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(f"ffprobe returned non-numeric duration: {probe.stdout!r}") from exc


def _has_audio_stream(video_path: Path) -> bool:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(video_path),
        ],
        capture_output=True,
        text=True,
    )
    return probe.returncode == 0 and bool(probe.stdout.strip())


def _write_silence(audio_path: Path, duration: float, sample_rate: int) -> None:
    """Generate mono PCM silence matching the video timeline (mute / no-audio rips)."""
    dur = max(float(duration), 0.01)
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"anullsrc=r={sample_rate}:cl=mono",
        "-t",
        f"{dur:.6f}",
        "-c:a",
        "pcm_s16le",
        str(audio_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg silence synth failed:\n{proc.stderr[-2000:]}")


def extract_audio(
    video_path: Path,
    audio_path: Path,
    sample_rate: int = 22050,
    video_duration: float | None = None,
) -> Path:
    """Write a zero-based mono WAV matching the video master timeline.

    Just Dance UI rips often ship without an audio stream. In that case we write
    matching silence; beat tracking still requires explicit fallback timing.
    """
    video_path = Path(video_path)
    audio_path = Path(audio_path)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    duration = (
        float(video_duration)
        if video_duration is not None
        else _video_duration_seconds(video_path)
    )
    if duration <= 0:
        raise ValueError("video duration must be positive")

    if not _has_audio_stream(video_path):
        _write_silence(audio_path, duration, sample_rate)
        if not audio_path.is_file():
            raise RuntimeError(f"ffmpeg did not write {audio_path}")
        return audio_path

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        (
            "aresample=async=1:first_pts=0,"
            f"apad,atrim=duration={duration:.6f}"
        ),
        "-t",
        f"{duration:.6f}",
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
        # Retry as silence if the container has no usable audio payload.
        err = proc.stderr or ""
        if "does not contain any stream" in err or "Output file does not contain any stream" in err:
            _write_silence(audio_path, duration, sample_rate)
        else:
            raise RuntimeError(f"ffmpeg audio extract failed:\n{err[-2000:]}")
    if not audio_path.is_file():
        raise RuntimeError(f"ffmpeg did not write {audio_path}")
    return audio_path
