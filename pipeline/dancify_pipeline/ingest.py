"""Local video ingest + optional yt-dlp download."""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2


def video_duration_seconds(video_path: Path) -> float:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    cap.release()
    if frames > 0 and fps > 0:
        return float(frames / fps)
    # Fallback via ffprobe
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return float(proc.stdout.strip())


def download_url(url: str, dest: Path) -> Path:
    """Download with yt-dlp into dest (file path with extension)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(dest.with_suffix("")) + ".%(ext)s"
    cmd = [
        "yt-dlp",
        "-f",
        "bv*[height<=720]+ba/b[height<=720]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tmpl,
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed:\n{proc.stderr[-2000:]}")
    # find produced file
    candidates = list(dest.parent.glob(dest.stem + ".*"))
    videos = [p for p in candidates if p.suffix.lower() in {".mp4", ".webm", ".mkv"}]
    if not videos:
        raise RuntimeError(f"yt-dlp produced no video next to {dest}")
    return videos[0]


def resolve_input(path_or_url: str, work_dir: Path) -> Path:
    p = Path(path_or_url)
    if p.is_file():
        return p.resolve()
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return download_url(path_or_url, work_dir / "download.mp4")
    raise FileNotFoundError(f"Input not found: {path_or_url}")
