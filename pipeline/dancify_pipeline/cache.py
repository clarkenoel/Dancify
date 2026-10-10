"""Push chart + audio to the local song-cache backend."""

from __future__ import annotations

from pathlib import Path

import requests


def _require_success(response: requests.Response, action: str) -> None:
    if response.status_code >= 400:
        raise RuntimeError(
            f"{action} failed ({response.status_code}): {response.text[:2000]}"
        )


def upload_chart(
    song_id: str,
    chart_path: Path,
    audio_path: Path | None = None,
    base_url: str = "http://127.0.0.1:8000",
) -> dict:
    url = f"{base_url.rstrip('/')}/songs/{song_id}/chart"
    files = {
        "chart": ("dance.json", Path(chart_path).read_bytes(), "application/json"),
    }
    if audio_path and Path(audio_path).is_file():
        files["audio"] = (
            Path(audio_path).name,
            Path(audio_path).read_bytes(),
            "audio/wav",
        )
    resp = requests.put(url, files=files, timeout=60)
    _require_success(resp, "cache upload")
    return resp.json()


def mark_processing(song_id: str, base_url: str = "http://127.0.0.1:8000") -> None:
    url = f"{base_url.rstrip('/')}/songs/{song_id}"
    response = requests.patch(url, json={"status": "processing"}, timeout=30)
    _require_success(response, "mark processing")


def mark_failed(
    song_id: str, message: str, base_url: str = "http://127.0.0.1:8000"
) -> None:
    url = f"{base_url.rstrip('/')}/songs/{song_id}"
    response = requests.patch(
        url, json={"status": "failed", "error_message": message[:2000]}, timeout=30
    )
    _require_success(response, "mark failed")
