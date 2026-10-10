#!/usr/bin/env python3
"""Build and seed reproducible demo bundles from clean-checkout assets.

The mandatory demo is generated from the tracked ``Video_1.mp4`` and
``audio_1.m4a`` files. Optional ``sample_a.mp4`` and ``sample_b.mp4`` fixtures
are used only when already present locally. Generated media stays in a temporary
work directory; only the gitignored manifest/results files are persisted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PIPELINE_ROOT = ROOT / "pipeline"
DATA_DIR = ROOT / "backend" / "data"
DEFAULT_MANIFEST = DATA_DIR / "demo_seed_manifest.json"
DEFAULT_RESULTS = DATA_DIR / "demo_seed_results.json"


@dataclass(frozen=True)
class DemoSpec:
    key: str
    title: str
    video: Path
    audio_sidecar: Path | None
    required: bool
    start_time: float = 0.0
    end_time: float | None = None


MANDATORY = DemoSpec(
    key="jd_video_1",
    title="Just Dance Video 1 Demo",
    video=PIPELINE_ROOT / "testdata" / "Video_1.mp4",
    audio_sidecar=PIPELINE_ROOT / "testdata" / "audio_1.m4a",
    required=True,
    end_time=59.5,
)
OPTIONAL = (
    DemoSpec(
        key="sample_a",
        title="Charli LISA Dance Challenge",
        video=PIPELINE_ROOT / "testdata" / "sample_a.mp4",
        audio_sidecar=None,
        required=False,
    ),
    DemoSpec(
        key="sample_b",
        title="Vegas Solo Street Dance",
        video=PIPELINE_ROOT / "testdata" / "sample_b.mp4",
        audio_sidecar=None,
        required=False,
    ),
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _path_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json_file(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _run(command: list[str], *, label: str) -> None:
    process = subprocess.run(command, capture_output=True, text=True)
    if process.returncode:
        output = "\n".join(
            part.strip() for part in (process.stdout, process.stderr) if part.strip()
        )
        raise RuntimeError(f"{label} failed ({process.returncode}):\n{output[-4000:]}")
    if process.stdout.strip():
        print(process.stdout.strip())


def _probe(path: Path) -> dict[str, Any]:
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,start_time:stream=codec_type,start_time,duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if process.returncode:
        raise RuntimeError(f"ffprobe failed for {path}:\n{process.stderr[-2000:]}")
    return json.loads(process.stdout)


def _duration(path: Path) -> float:
    try:
        duration = float(_probe(path)["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"Could not read a positive duration from {path}") from exc
    if duration <= 0:
        raise RuntimeError(f"Could not read a positive duration from {path}")
    return duration


def _mux_video_master(
    video: Path,
    audio: Path,
    output: Path,
    *,
    start_time: float = 0.0,
    end_time: float | None = None,
) -> float:
    """Mux a selected playable range on a new zero-based video timeline."""
    source_duration = _duration(video)
    end = end_time if end_time is not None else source_duration
    if start_time < 0 or end <= start_time or end > source_duration + 0.1:
        raise RuntimeError("Demo range is outside the source timeline")
    duration = min(end, source_duration) - start_time
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-nostdin",
        "-y",
    ]
    if start_time > 0:
        command.extend(["-ss", f"{start_time:.6f}"])
    command.extend(["-i", str(video)])
    if start_time > 0:
        command.extend(["-ss", f"{start_time:.6f}"])
    command.extend(
        [
            "-i",
            str(audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-af",
            f"aresample=async=1:first_pts=0,apad,atrim=duration={duration:.6f}",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            f"{duration:.6f}",
            "-movflags",
            "+faststart",
            "-avoid_negative_ts",
            "make_zero",
            str(output),
        ]
    )
    _run(
        command,
        label="video/audio mux",
    )
    probe = _probe(output)
    stream_types = {stream.get("codec_type") for stream in probe.get("streams", [])}
    if stream_types != {"video", "audio"}:
        raise RuntimeError(f"Muxed demo must contain video and audio: {stream_types}")
    muxed_duration = _duration(output)
    if abs(muxed_duration - duration) > 0.1:
        raise RuntimeError(
            f"Muxed duration {muxed_duration:.3f}s does not match "
            f"video master {duration:.3f}s"
        )
    return duration


@dataclass(frozen=True)
class HttpResponse:
    body: bytes
    status: int
    headers: dict[str, str]


def _request(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> HttpResponse:
    request = urllib.request.Request(
        url,
        data=data,
        headers=headers or {},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return HttpResponse(
                body=response.read(),
                status=response.status,
                headers={key.lower(): value for key, value in response.headers.items()},
            )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"{method} {url} failed ({exc.code}): {detail[:2000]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {url} failed: {exc}") from exc


def _json_request(
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    response = _request(method, url, data=data, headers=headers)
    return json.loads(response.body.decode("utf-8"))


def _multipart_request(
    method: str,
    url: str,
    *,
    fields: dict[str, str] | None = None,
    files: list[tuple[str, Path, str]] | None = None,
) -> dict[str, Any]:
    boundary = f"----dancify{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in (fields or {}).items():
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode()
        )
    for name, path, content_type in files or []:
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{path.name}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
            + path.read_bytes()
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    response = _request(
        method,
        url,
        data=b"".join(parts),
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    value = json.loads(response.body.decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected object response from {method} {url}")
    return value


def _manifest_id(manifest: dict[str, Any], key: str) -> str | None:
    songs = manifest.get("songs")
    if not isinstance(songs, list):
        return None
    for song in songs:
        if isinstance(song, dict) and song.get("key") == key:
            value = song.get("id")
            return value if isinstance(value, str) else None
    return None


def _select_existing_song(
    songs: list[dict[str, Any]],
    manifest: dict[str, Any],
    spec: DemoSpec,
) -> dict[str, Any] | None:
    by_id = {
        song.get("id"): song
        for song in songs
        if isinstance(song.get("id"), str)
    }
    recorded_id = _manifest_id(manifest, spec.key)
    if recorded_id and recorded_id in by_id:
        return by_id[recorded_id]
    matches = [song for song in songs if song.get("title") == spec.title]
    if len(matches) > 1:
        raise RuntimeError(
            f"Multiple songs named {spec.title!r}; restore the manifest or "
            "remove the unintended duplicate"
        )
    return matches[0] if matches else None


def _preflight(pipeline_python: Path) -> None:
    missing_tools = [name for name in ("ffmpeg", "ffprobe") if not shutil.which(name)]
    missing_files = [
        path
        for path in (
            MANDATORY.video,
            MANDATORY.audio_sidecar,
            PIPELINE_ROOT / "main.py",
        )
        if path is None or not path.is_file()
    ]
    if missing_tools or missing_files:
        details = []
        if missing_tools:
            details.append(f"missing tools: {', '.join(missing_tools)}")
        if missing_files:
            details.append(
                "missing tracked files: " + ", ".join(str(path) for path in missing_files)
            )
        raise RuntimeError("; ".join(details))
    if not pipeline_python.is_file():
        raise RuntimeError(
            f"Pipeline Python not found: {pipeline_python}. "
            "Create pipeline/.venv and install pipeline/requirements-dev.txt."
        )
    _run(
        [
            str(pipeline_python),
            "-c",
            (
                "import cv2, jsonschema, librosa, mediapipe, numpy, scipy; "
                "print('pipeline dependency preflight ok')"
            ),
        ],
        label="pipeline dependency preflight",
    )


def _run_pipeline(
    pipeline_python: Path,
    video: Path,
    output_dir: Path,
) -> tuple[Path, Path, dict[str, Any]]:
    chart = output_dir / "dance.json"
    audio = output_dir / "audio.wav"
    work = output_dir / "work"
    _run(
        [
            str(pipeline_python),
            str(PIPELINE_ROOT / "main.py"),
            "--input",
            str(video),
            "--output",
            str(chart),
            "--audio-out",
            str(audio),
            "--work-dir",
            str(work),
        ],
        label=f"pipeline generation for {video.name}",
    )
    report_path = chart.with_name("dance.report.json")
    for path in (chart, audio, report_path):
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Pipeline did not produce {path}")
    report = _load_json_file(report_path)
    readiness = report.get("readiness", {})
    if (
        not isinstance(readiness, dict)
        or readiness.get("synthetic_timing") is not False
        or readiness.get("cache_ready_by_default") is not True
    ):
        raise RuntimeError(f"Pipeline report is not cache-ready: {report}")
    return chart, audio, report


def _ensure_song(
    base_url: str,
    spec: DemoSpec,
    reference_video: Path,
    manifest: dict[str, Any],
) -> tuple[dict[str, Any], bool, bool, int]:
    songs = _json_request("GET", f"{base_url}/songs")
    if not isinstance(songs, list):
        raise RuntimeError("GET /songs did not return an array")
    existing = _select_existing_song(songs, manifest, spec)
    if existing is None:
        created = _multipart_request(
            "POST",
            f"{base_url}/songs",
            fields={"title": spec.title},
            files=[("video", reference_video, "video/mp4")],
        )
        return created, False, True, 0

    song_id = str(existing["id"])
    play_count = int(existing.get("play_count", 0))
    if existing.get("title") != spec.title:
        existing = _json_request(
            "PATCH",
            f"{base_url}/songs/{song_id}",
            {"title": spec.title},
        )

    video_replaced = True
    if existing.get("has_video"):
        remote_video = _request("GET", f"{base_url}/songs/{song_id}/video").body
        video_replaced = _sha256(remote_video) != _path_sha256(reference_video)
    if video_replaced:
        existing = _multipart_request(
            "POST",
            f"{base_url}/songs/{song_id}/video",
            files=[("video", reference_video, "video/mp4")],
        )
    return existing, True, video_replaced, play_count


def _verify_ready_bundle(
    base_url: str,
    song_id: str,
    reference_video: Path,
    chart: Path,
    audio: Path,
    expected_play_count: int,
) -> dict[str, Any]:
    song = _json_request("GET", f"{base_url}/songs/{song_id}")
    required = {
        "status": "ready",
        "has_video": True,
        "has_chart": True,
        "has_audio": True,
    }
    mismatches = {
        key: (song.get(key), value)
        for key, value in required.items()
        if song.get(key) != value
    }
    if mismatches:
        raise RuntimeError(f"Song bundle is not ready: {mismatches}")
    if int(song.get("play_count", -1)) != expected_play_count:
        raise RuntimeError(
            "Play history changed during seed: "
            f"{expected_play_count} -> {song.get('play_count')}"
        )

    expected = {
        "video": reference_video.read_bytes(),
        "chart": chart.read_bytes(),
        "audio": audio.read_bytes(),
    }
    responses = {
        name: _request("GET", f"{base_url}/songs/{song_id}/{name}")
        for name in expected
    }
    for name, response in responses.items():
        if response.status != 200 or response.body != expected[name]:
            raise RuntimeError(f"GET /songs/{song_id}/{name} did not match upload")
    chart_payload = json.loads(responses["chart"].body.decode("utf-8"))
    if not isinstance(chart_payload, dict) or not chart_payload.get("moves"):
        raise RuntimeError("Downloaded chart is not a non-empty dance object")
    return {
        "play_count": expected_play_count,
        "sha256": {name: _sha256(response.body) for name, response in responses.items()},
        "content_types": {
            name: response.headers.get("content-type") for name, response in responses.items()
        },
    }


def _seed_demo(
    base_url: str,
    pipeline_python: Path,
    spec: DemoSpec,
    work_root: Path,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    demo_dir = work_root / spec.key
    demo_dir.mkdir(parents=True, exist_ok=True)
    reference_video = spec.video
    video_master_duration = _duration(spec.video)
    if spec.audio_sidecar is not None:
        reference_video = demo_dir / "reference.mp4"
        video_master_duration = _mux_video_master(
            spec.video,
            spec.audio_sidecar,
            reference_video,
            start_time=spec.start_time,
            end_time=spec.end_time,
        )

    chart, extracted_audio, report = _run_pipeline(
        pipeline_python,
        reference_video,
        demo_dir / "generated",
    )
    song, reused, video_replaced, play_count = _ensure_song(
        base_url,
        spec,
        reference_video,
        manifest,
    )
    song_id = str(song["id"])
    ready = _multipart_request(
        "PUT",
        f"{base_url}/songs/{song_id}/chart",
        files=[
            ("chart", chart, "application/json"),
            ("audio", extracted_audio, "audio/wav"),
            ("report", chart.with_name("dance.report.json"), "application/json"),
        ],
    )
    if ready.get("status") != "ready":
        raise RuntimeError(f"Bundle upload did not make {spec.key} ready: {ready}")
    verification = _verify_ready_bundle(
        base_url,
        song_id,
        reference_video,
        chart,
        extracted_audio,
        play_count,
    )
    entry = {
        "key": spec.key,
        "id": song_id,
        "title": spec.title,
        "status": "ready",
        "required": spec.required,
        "reused_identity": reused,
        "video_replaced": video_replaced,
        "source_video": str(spec.video.relative_to(ROOT)),
        "source_audio": (
            str(spec.audio_sidecar.relative_to(ROOT))
            if spec.audio_sidecar is not None
            else "embedded"
        ),
        "video_master_duration": round(video_master_duration, 6),
        "source_range": {
            "start": spec.start_time,
            "end": spec.end_time,
        },
        "bpm": ready.get("bpm"),
        "duration": ready.get("duration"),
        "move_count": ready.get("move_count"),
        "song_url": f"{base_url}/songs/{song_id}",
        "video_url": f"{base_url}/songs/{song_id}/video",
        "chart_url": f"{base_url}/songs/{song_id}/chart",
        "audio_url": f"{base_url}/songs/{song_id}/audio",
        "pipeline_report": report,
        "verification": verification,
    }
    print(
        f"ok {spec.key}: {song_id}  bpm={entry['bpm']}  "
        f"moves={entry['move_count']}  reused={reused}"
    )
    return entry


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    default_pipeline_python = PIPELINE_ROOT / ".venv" / "bin" / "python"
    parser = argparse.ArgumentParser(
        description="Generate and seed clean-checkout Dancify demos"
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("BASE_URL", "http://127.0.0.1:8000"),
    )
    parser.add_argument(
        "--pipeline-python",
        type=Path,
        default=Path(os.environ.get("PIPELINE_PYTHON", default_pipeline_python)),
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=None,
        help="Keep generated scratch files here instead of a temporary directory",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _arguments(argv)
    base_url = args.base_url.rstrip("/")
    pipeline_python = args.pipeline_python.absolute()
    results: dict[str, Any] = {
        "version": "1.0",
        "status": "running",
        "started_at": _now(),
        "base_url": base_url,
        "mandatory": None,
        "optional": [],
    }
    try:
        _preflight(pipeline_python)
        health = _json_request("GET", f"{base_url}/health")
        if not isinstance(health, dict) or health.get("ok") is not True:
            raise RuntimeError(f"Backend is not healthy at {base_url}: {health}")

        previous_manifest = _load_json_file(args.manifest)
        temporary: tempfile.TemporaryDirectory[str] | None = None
        if args.work_dir is None:
            temporary = tempfile.TemporaryDirectory(prefix="dancify-demo-seed-")
            work_root = Path(temporary.name)
        else:
            work_root = args.work_dir.resolve()
            work_root.mkdir(parents=True, exist_ok=True)
        try:
            mandatory = _seed_demo(
                base_url,
                pipeline_python,
                MANDATORY,
                work_root,
                previous_manifest,
            )
            results["mandatory"] = mandatory

            optional_entries: list[dict[str, Any]] = []
            for spec in OPTIONAL:
                if not spec.video.is_file():
                    message = f"optional local fixture absent: {spec.video.relative_to(ROOT)}"
                    print(f"skip {spec.key}: {message}")
                    optional_entries.append(
                        {"key": spec.key, "status": "skipped", "reason": message}
                    )
                    continue
                try:
                    optional_entries.append(
                        _seed_demo(
                            base_url,
                            pipeline_python,
                            spec,
                            work_root,
                            previous_manifest,
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"warn {spec.key}: {exc}", file=sys.stderr)
                    optional_entries.append(
                        {"key": spec.key, "status": "failed", "reason": str(exc)}
                    )
            results["optional"] = optional_entries
        finally:
            if temporary is not None:
                temporary.cleanup()

        entries = [results["mandatory"]] + [
            entry
            for entry in results["optional"]
            if isinstance(entry, dict) and entry.get("status") == "ready"
        ]
        manifest = {
            "version": "1.0",
            "base_url": base_url,
            "updated_at": _now(),
            "songs": entries,
        }
        results["status"] = (
            "ok_with_optional_failures"
            if any(entry.get("status") == "failed" for entry in results["optional"])
            else "ok"
        )
        results["finished_at"] = _now()
        _write_json_atomic(args.manifest, manifest)
        _write_json_atomic(args.results, results)
        print(f"wrote {args.manifest}")
        print(f"wrote {args.results}")
        print("BAKE OK")
        return 0
    except Exception as exc:  # noqa: BLE001
        results["status"] = "failed"
        results["error"] = str(exc)
        results["finished_at"] = _now()
        _write_json_atomic(args.results, results)
        print(f"error: {exc}", file=sys.stderr)
        print(f"failure details: {args.results}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
