#!/usr/bin/env python3
"""Seed song-cache with ready demo charts (no MediaPipe re-run).

Prerequisites:
  - Backend up on BASE_URL (default http://127.0.0.1:8000)
  - Charts + audio under pipeline/outputs/

Usage (repo root):
  python3 backend/scripts/bake_demo_songs.py

Writes: backend/data/demo_seed_manifest.json
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
PIPE_OUT = ROOT / "pipeline" / "outputs"
MANIFEST = ROOT / "backend" / "data" / "demo_seed_manifest.json"

DEMOS = [
    {
        "key": "sample_a",
        "title": "Charli LISA Dance Challenge",
        "source_url": "https://www.tiktok.com/@charlidamelio/video/7694571903222156575",
        "chart": PIPE_OUT / "sample_a.json",
        "audio": PIPE_OUT / "_work_sample_a" / "audio.wav",
        "required": True,
    },
    {
        "key": "sample_b",
        "title": "Vegas Solo Street Dance",
        "source_url": "https://www.tiktok.com/@gottaluvemman/video/7661302454079819039",
        "chart": PIPE_OUT / "sample_b.json",
        "audio": PIPE_OUT / "_work_sample_b" / "audio.wav",
        "required": True,
    },
    {
        "key": "jd_audio_1",
        "title": "Just Dance Video_1 (muxed audio)",
        "source_url": "local:pipeline/testdata/jd_video_1_with_audio.mp4",
        "chart": PIPE_OUT / "jd_audio_1.json",
        "audio": PIPE_OUT / "_work_jd_audio_1" / "audio.wav",
        "required": False,
    },
]


def _request(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _json(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    return json.loads(_request(method, url, data=data, headers=headers).decode())


def _multipart_put(url: str, chart: Path, audio: Path) -> dict:
    import uuid

    boundary = f"----dancify{uuid.uuid4().hex}"
    parts: list[bytes] = []

    def add_file(name: str, path: Path, content_type: str) -> None:
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
            + path.read_bytes()
            + b"\r\n"
        )

    add_file("chart", chart, "application/json")
    add_file("audio", audio, "audio/wav")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    }
    return json.loads(_request("PUT", url, data=body, headers=headers).decode())


def delete_by_title(title: str) -> None:
    songs = _json("GET", f"{BASE}/songs")
    for song in songs:
        if song.get("title") == title:
            _request("DELETE", f"{BASE}/songs/{song['id']}")
            print(f"deleted previous {title} ({song['id']})", file=sys.stderr)


def bake_one(demo: dict) -> dict | None:
    chart: Path = demo["chart"]
    audio: Path = demo["audio"]
    if not chart.is_file() or not audio.is_file():
        msg = f"skip {demo['key']}: missing {chart if not chart.is_file() else audio}"
        if demo["required"]:
            raise FileNotFoundError(msg)
        print(msg, file=sys.stderr)
        return None

    delete_by_title(demo["title"])
    created = _json(
        "POST",
        f"{BASE}/songs/json",
        {"title": demo["title"], "source_url": demo["source_url"]},
    )
    song_id = created["id"]
    _json("PATCH", f"{BASE}/songs/{song_id}", {"status": "processing"})
    ready = _multipart_put(f"{BASE}/songs/{song_id}/chart", chart, audio)
    if ready.get("status") != "ready" or not ready.get("has_chart") or not ready.get(
        "has_audio"
    ):
        raise RuntimeError(f"bake failed for {demo['key']}: {ready}")

    entry = {
        "key": demo["key"],
        "id": ready["id"],
        "title": ready["title"],
        "bpm": ready["bpm"],
        "duration": ready["duration"],
        "move_count": ready["move_count"],
        "status": ready["status"],
        "chart_url": f"{BASE}/songs/{ready['id']}/chart",
        "audio_url": f"{BASE}/songs/{ready['id']}/audio",
        "song_url": f"{BASE}/songs/{ready['id']}",
    }
    print(
        f"ok {entry['id']}  {entry['title']}  bpm={entry['bpm']}  moves={entry['move_count']}"
    )
    return entry


def main() -> int:
    try:
        health = _json("GET", f"{BASE}/health")
    except urllib.error.URLError as exc:
        print(f"error: backend not reachable at {BASE}: {exc}", file=sys.stderr)
        print(
            "start: cd backend && . .venv/bin/activate && "
            "uvicorn app.main:app --host 127.0.0.1 --port 8000",
            file=sys.stderr,
        )
        return 1
    if not health.get("ok"):
        print(f"error: unhealthy backend: {health}", file=sys.stderr)
        return 1

    entries: list[dict] = []
    for demo in DEMOS:
        entry = bake_one(demo)
        if entry:
            entries.append(entry)

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"base_url": BASE, "songs": entries}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {MANIFEST} ({len(entries)} songs)")

    songs = _json("GET", f"{BASE}/songs")
    ready = [s for s in songs if s.get("status") == "ready"]
    print(f"verify: {len(ready)} ready / {len(songs)} total")
    for song in ready:
        print(
            f"  {song['id']} | {song['title']} | bpm {song['bpm']} | moves {song['move_count']}"
        )
    print("BAKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
