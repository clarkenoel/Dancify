"""Local video ingest + optional yt-dlp download."""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import cv2


def _ffprobe_duration(video_path: Path, stream: bool) -> float | None:
    entries = "stream=duration" if stream else "format=duration"
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            *(["-select_streams", "v:0"] if stream else []),
            "-show_entries",
            entries,
            "-of",
            "default=nw=1:nk=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return None
    try:
        value = float(proc.stdout.strip())
    except ValueError:
        return None
    return value if value > 0 else None


def video_duration_seconds(video_path: Path) -> float:
    """Video-stream duration on the media element's zero-based timeline."""
    for stream in (True, False):
        duration = _ffprobe_duration(video_path, stream=stream)
        if duration is not None:
            return duration

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video or probe duration: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    cap.release()
    if frames > 0 and fps > 0:
        return float(frames / fps)
    raise RuntimeError(f"Could not determine video duration: {video_path}")


def video_aspect_ratio(video_path: Path) -> float:
    """Return display width / height for aspect-aware pose normalization."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video for dimensions: {video_path}")
    width = float(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0.0)
    height = float(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0.0)
    cap.release()
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Could not determine video dimensions: {video_path}")
    return width / height


def download_url(url: str, dest: Path) -> Path:
    """Download into a URL-keyed path, replacing stale prior content."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    stem = f"{dest.stem}-{digest}"
    for old in dest.parent.glob(stem + ".*"):
        if old.is_file():
            old.unlink()
    out_tmpl = str(dest.parent / stem) + ".%(ext)s"
    cmd = [
        "yt-dlp",
        "--force-overwrites",
        "--no-part",
        "-f",
        "bv*[height<=720]+ba/b[height<=720]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tmpl,
    ]
    cookies_file = os.environ.get("DANCIFY_YTDLP_COOKIES_FILE")
    if cookies_file:
        cookie_path = Path(cookies_file).expanduser().resolve()
        if not cookie_path.is_file():
            raise RuntimeError(
                "Configured yt-dlp cookie file is unavailable"
            )
        cmd.extend(["--cookies", str(cookie_path)])
    impersonate = os.environ.get("DANCIFY_YTDLP_IMPERSONATE")
    if impersonate:
        cmd.extend(["--impersonate", impersonate])
    cmd.append(url)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed:\n{proc.stderr[-2000:]}")
    # find produced file
    candidates = list(dest.parent.glob(stem + ".*"))
    videos = [p for p in candidates if p.suffix.lower() in {".mp4", ".webm", ".mkv"}]
    if not videos:
        raise RuntimeError(f"yt-dlp produced no video next to {dest}")
    return max(videos, key=lambda path: path.stat().st_mtime_ns)


def resolve_input(path_or_url: str, work_dir: Path) -> Path:
    p = Path(path_or_url)
    if p.is_file():
        return p.resolve()
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return download_url(path_or_url, work_dir / "download.mp4")
    raise FileNotFoundError(f"Input not found: {path_or_url}")
