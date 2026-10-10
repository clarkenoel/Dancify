#!/usr/bin/env python3
"""Prepare one URL or local upload into the same normalized bundle outputs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any

from dancify_pipeline.beats import ExplicitTimingRequired
from dancify_pipeline.ingest import resolve_input, video_duration_seconds
from dancify_pipeline.pipeline import run_pipeline
from dancify_pipeline.tracking import TrackingQualityError


class UnsupportedMediaError(RuntimeError):
    pass


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


def _has_audio(path: Path) -> bool:
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return process.returncode == 0 and bool(process.stdout.strip())


def normalize_reference(
    source: Path,
    destination: Path,
    *,
    start_time: float | None = None,
    end_time: float | None = None,
) -> Path:
    if not _has_audio(source):
        raise ExplicitTimingRequired(
            "Reference media has no intended music track; upload a video with audio"
        )
    try:
        source_duration = video_duration_seconds(source)
    except Exception as exc:
        raise UnsupportedMediaError("Could not read the reference video timeline") from exc
    start = float(start_time or 0.0)
    end = float(end_time) if end_time is not None else source_duration
    if start < 0 or end <= start or end > source_duration + 0.25:
        raise UnsupportedMediaError(
            "Selected preparation range is outside the source timeline"
        )
    duration = min(end, source_duration) - start
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
            "ffmpeg",
            "-nostdin",
            "-y",
    ]
    if start > 0:
        command.extend(["-ss", f"{start:.6f}"])
    command.extend(
        [
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-vf",
            "fps=30",
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
            str(destination),
        ]
    )
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode or not destination.is_file():
        destination.unlink(missing_ok=True)
        raise UnsupportedMediaError("Could not normalize media to browser-compatible MP4")
    return destination


def _artifacts(output_dir: Path) -> dict[str, str | None]:
    candidates = {
        "report": output_dir / "dance.report.json",
        "diagnostic": output_dir / "dance.tracking.json",
        "diagnostic_video": output_dir / "dance.tracking.mp4",
    }
    return {
        name: str(path.resolve()) if path.is_file() else None
        for name, path in candidates.items()
    }


def _failure(
    manifest: Path,
    output_dir: Path,
    code: str,
    message: str,
) -> int:
    _write_json_atomic(
        manifest,
        {
            "version": "1.0",
            "status": "failed",
            "error_code": code,
            "error_message": message,
            **_artifacts(output_dir),
        },
    )
    return 1


def _progress(manifest: Path, stage: str) -> None:
    _write_json_atomic(
        manifest,
        {
            "version": "1.0",
            "status": "processing",
            "stage": stage,
        },
    )


def prepare(
    input_value: str,
    output_dir: Path,
    manifest: Path,
    *,
    start_time: float | None = None,
    end_time: float | None = None,
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    is_url = input_value.startswith(("http://", "https://"))
    _progress(manifest, "download" if is_url else "ingest")
    try:
        source = resolve_input(input_value, output_dir / "ingest")
    except Exception:
        if is_url:
            return _failure(
                manifest,
                output_dir,
                "download_failed",
                "URL download failed; upload a local video instead or configure yt-dlp authentication externally",
            )
        return _failure(
            manifest,
            output_dir,
            "unsupported_media",
            "Uploaded preparation input is missing or unreadable",
        )

    normalized = output_dir / "video.mp4"
    try:
        _progress(manifest, "normalize_media")
        normalize_reference(
            source,
            normalized,
            start_time=start_time,
            end_time=end_time,
        )
        _progress(manifest, "analyze")
        result = run_pipeline(
            input_path=str(normalized),
            output_json=output_dir / "dance.json",
            work_dir=output_dir / "work",
            save_audio=output_dir / "audio.wav",
        )
    except ExplicitTimingRequired:
        return _failure(
            manifest,
            output_dir,
            "timing_required",
            "Audible music with a reliable beat grid is required; upload a video with its intended music",
        )
    except TrackingQualityError as exc:
        return _failure(
            manifest,
            output_dir,
            "tracking_failed",
            str(exc)[:1000] or "Stable single-dancer tracking is required",
        )
    except UnsupportedMediaError as exc:
        return _failure(
            manifest,
            output_dir,
            "unsupported_media",
            str(exc),
        )
    except ValueError:
        return _failure(
            manifest,
            output_dir,
            "validation_failed",
            "Generated chart failed semantic validation",
        )
    except RuntimeError as exc:
        message = str(exc)
        if "No usable motion hits" in message or "No frames read" in message:
            code = "tracking_failed"
            safe = "No usable tracked dance checkpoints were found"
        elif "ffmpeg" in message or "ffprobe" in message or "Cannot open video" in message:
            code = "unsupported_media"
            safe = "Reference media could not be decoded"
        else:
            code = "internal"
            safe = "Pipeline preparation failed unexpectedly"
        return _failure(manifest, output_dir, code, safe)
    except Exception:
        return _failure(
            manifest,
            output_dir,
            "internal",
            "Pipeline preparation failed unexpectedly",
        )

    report_path = Path(str(result["report"]))
    try:
        _progress(manifest, "validate")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["preparation"] = {
            "driver": "pipeline/prepare_song.py",
            "source_kind": "url" if is_url else "upload",
            "browser_normalized": True,
            "video_codec": "h264",
            "audio_codec": "aac",
            "container": "mp4",
            "source_start_time": float(start_time or 0.0),
            "source_end_time": end_time,
        }
        _write_json_atomic(report_path, report)
    except (json.JSONDecodeError, OSError, TypeError):
        return _failure(
            manifest,
            output_dir,
            "validation_failed",
            "Pipeline report is missing or invalid",
        )

    outputs = {
        "video": normalized,
        "chart": output_dir / "dance.json",
        "audio": Path(str(result["audio"])),
        "report": report_path,
    }
    if any(not path.is_file() or path.stat().st_size <= 0 for path in outputs.values()):
        return _failure(
            manifest,
            output_dir,
            "validation_failed",
            "Pipeline did not produce a complete bundle",
        )
    _write_json_atomic(
        manifest,
        {
            "version": "1.0",
            "status": "succeeded",
            **{name: str(path.resolve()) for name, path in outputs.items()},
            **_artifacts(output_dir),
        },
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare one Dancify song bundle")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--start-time", type=float, default=None)
    parser.add_argument("--end-time", type=float, default=None)
    args = parser.parse_args()
    return prepare(
        args.input,
        args.output_dir.resolve(),
        args.manifest.resolve(),
        start_time=args.start_time,
        end_time=args.end_time,
    )


if __name__ == "__main__":
    raise SystemExit(main())
