"""Try to fetch a ≤20s single-dancer Short; fall back to Mixkit+music assembly."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PRIMARY_URL = "https://www.youtube.com/watch?v=HKRlrJNT6EQ"
MIXKIT_DANCE = "https://assets.mixkit.co/videos/4823/4823-720.mp4"
MUSIC_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"

ROOT = Path(__file__).resolve().parents[1]
TESTDATA = ROOT / "testdata"


def try_ytdlp(url: str, dest: Path) -> Path | None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    out = dest.with_suffix("") 
    cmd = [
        "yt-dlp",
        "-f",
        "b",
        "--merge-output-format",
        "mp4",
        "-o",
        str(out) + ".%(ext)s",
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr[-1500:], file=sys.stderr)
        return None
    found = list(dest.parent.glob(out.name + ".*"))
    videos = [p for p in found if p.suffix.lower() in {".mp4", ".webm", ".mkv"}]
    return videos[0] if videos else None


def assemble_fallback(dest: Path) -> Path:
    import urllib.request

    TESTDATA.mkdir(parents=True, exist_ok=True)
    silent = TESTDATA / "_dance_silent.mp4"
    music = TESTDATA / "_music.mp3"
    urllib.request.urlretrieve(MIXKIT_DANCE, silent)
    urllib.request.urlretrieve(MUSIC_URL, music)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(silent),
        "-i",
        str(music),
        "-t",
        "10.3",
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:])
    return dest


def main() -> int:
    dest = TESTDATA / "sample.mp4"
    print(f"Trying primary Short: {PRIMARY_URL}")
    got = try_ytdlp(PRIMARY_URL, dest)
    if got:
        print(f"Downloaded {got}")
        return 0
    print("Primary blocked; assembling Shorts-format Mixkit dancer + music fallback")
    path = assemble_fallback(dest)
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
