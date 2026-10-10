#!/usr/bin/env python3
"""Human-operated preparation smoke for local upload or URL acquisition."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import requests


def request_json(
    method: str,
    url: str,
    *,
    timeout: int = 120,
    **kwargs,
) -> dict:
    response = requests.request(method, url, timeout=timeout, **kwargs)
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise RuntimeError(f"{method} {url} did not return an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--video", type=Path)
    source.add_argument("--url")
    parser.add_argument("--start-time", type=float, default=None)
    parser.add_argument("--end-time", type=float, default=None)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--keep-song", action="store_true")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    if args.video is not None:
        with args.video.open("rb") as handle:
            song = request_json(
                "POST",
                f"{base}/songs",
                data={"title": f"Smoke {args.video.name}"},
                files={"video": (args.video.name, handle, "video/mp4")},
            )
        source_kind = "upload"
    else:
        song = request_json(
            "POST",
            f"{base}/songs/json",
            json={"title": "Smoke URL", "source_url": args.url},
        )
        source_kind = "url"

    song_id = str(song["id"])
    try:
        options = {
            "source_kind": source_kind,
            "start_time": args.start_time,
            "end_time": args.end_time,
        }
        job = request_json(
            "POST",
            f"{base}/songs/{song_id}/preparations",
            json={key: value for key, value in options.items() if value is not None},
        )
        deadline = time.monotonic() + args.timeout
        state = job
        while state["status"] not in {"succeeded", "failed"}:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Preparation timed out: {state}")
            time.sleep(1)
            state = request_json(
                "GET",
                f"{base}/songs/{song_id}/preparations/{job['id']}",
            )
            print(state["status"], state["stage"])
        if state["status"] != "succeeded":
            print(json.dumps(state, indent=2))
            return 2

        detail = request_json("GET", f"{base}/songs/{song_id}")
        bundle_id = str(detail["active_bundle_id"])
        assets = {}
        for asset in ("video", "chart", "audio", "report"):
            response = requests.get(
                f"{base}/songs/{song_id}/bundles/{bundle_id}/{asset}",
                timeout=120,
            )
            response.raise_for_status()
            assets[asset] = response
        chart = assets["chart"].json()
        play = request_json(
            "POST",
            f"{base}/songs/{song_id}/plays",
            json={
                "player_name": "prepare-smoke",
                "bundle_id": bundle_id,
                "score": 1,
            },
        )
        assert play["bundle_id"] == bundle_id
        print(
            "PREPARATION SMOKE OK",
            json.dumps(
                {
                    "song_id": song_id,
                    "bundle_id": bundle_id,
                    "moves": len(chart["moves"]),
                    "source_kind": source_kind,
                }
            ),
        )
        return 0
    finally:
        if not args.keep_song:
            requests.delete(f"{base}/songs/{song_id}", timeout=30)


if __name__ == "__main__":
    raise SystemExit(main())
