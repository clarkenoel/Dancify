"""Fetch a ≤20s single-dancer Short/TikTok; fall back to Mixkit+music assembly."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

PRIMARY_YT = "https://www.youtube.com/watch?v=HKRlrJNT6EQ"
TIKTOK_FALLBACK = (
    "https://www.tiktok.com/@official_kep1er/video/7225090219391896834"
)
MIXKIT_DANCE = "https://assets.mixkit.co/videos/4823/4823-720.mp4"
MUSIC_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"

ROOT = Path(__file__).resolve().parents[1]
TESTDATA = ROOT / "testdata"


def try_ytdlp(url: str, dest: Path, *, impersonate: bool = False) -> Path | None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    out = dest.with_suffix("")
    for old in dest.parent.glob(out.name + ".*"):
        if old.is_file():
            old.unlink()
    cmd = [
        "yt-dlp",
        "--force-overwrites",
        "--no-part",
        "-f",
        "b",
        "--merge-output-format",
        "mp4",
        "-o",
        str(out) + ".%(ext)s",
    ]
    if impersonate:
        cmd += ["--impersonate", "chrome"]
    cmd.append(url)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr[-1200:], file=sys.stderr)
        return None
    found = list(dest.parent.glob(out.name + ".*"))
    videos = [p for p in found if p.suffix.lower() in {".mp4", ".webm", ".mkv"}]
    if not videos:
        return None
    # Normalize name to sample.mp4
    chosen = videos[0]
    if chosen.resolve() != dest.resolve():
        shutil.move(str(chosen), str(dest))
    return dest


def assemble_mixkit(dest: Path) -> Path:
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
    print(f"1) YouTube Short: {PRIMARY_YT}")
    if try_ytdlp(PRIMARY_YT, dest):
        print(f"Downloaded {dest}")
        return 0
    print(f"2) TikTok dance (impersonate chrome): {TIKTOK_FALLBACK}")
    if try_ytdlp(TIKTOK_FALLBACK, dest, impersonate=True):
        print(f"Downloaded {dest}")
        return 0
    print("3) Mixkit dancer + music assemble (last resort)")
    path = assemble_mixkit(dest)
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
