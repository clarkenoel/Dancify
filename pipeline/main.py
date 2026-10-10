#!/usr/bin/env python3
"""CLI: video → dance.json (+ optional backend chart cache)."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from dancify_pipeline.cache import mark_failed, mark_processing, upload_chart
from dancify_pipeline.pipeline import run_pipeline


def positive_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def nonnegative_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dancify prep pipeline")
    parser.add_argument("--input", "-i", required=True, help="Local video path or URL")
    parser.add_argument("--output", "-o", required=True, help="Output dance.json path")
    parser.add_argument(
        "--work-dir",
        default=None,
        help="Scratch dir for audio / debug arrays (default: next to output)",
    )
    parser.add_argument("--audio-out", default=None, help="Where to write extracted WAV")
    parser.add_argument("--fps", type=positive_float, default=30.0, help="Pose sample rate")
    parser.add_argument(
        "--fallback-bpm",
        type=positive_float,
        default=None,
        help="Explicit BPM for mute/untrackable audio (requires --fallback-downbeat)",
    )
    parser.add_argument(
        "--fallback-downbeat",
        type=nonnegative_float,
        default=None,
        help="First synthetic beat in seconds (requires --fallback-bpm)",
    )
    parser.add_argument(
        "--allow-synthetic-cache",
        action="store_true",
        help="Explicitly allow synthetic-timing charts to become cache-ready",
    )
    parser.add_argument(
        "--song-id",
        default=None,
        help="If set, PUT chart+audio to song-cache API after success",
    )
    parser.add_argument(
        "--api-base",
        default="http://127.0.0.1:8000",
        help="Song-cache base URL",
    )
    args = parser.parse_args(argv)
    if (args.fallback_bpm is None) != (args.fallback_downbeat is None):
        parser.error("--fallback-bpm and --fallback-downbeat must be supplied together")

    output = Path(args.output)
    work_dir = Path(args.work_dir) if args.work_dir else output.parent / "_work"
    audio_out = Path(args.audio_out) if args.audio_out else work_dir / "audio.wav"

    if args.song_id:
        try:
            mark_processing(args.song_id, args.api_base)
        except Exception as exc:  # noqa: BLE001
            print(f"error: could not mark processing: {exc}", file=sys.stderr)
            return 2

    try:
        result = run_pipeline(
            input_path=args.input,
            output_json=output,
            work_dir=work_dir,
            target_fps=args.fps,
            save_audio=audio_out,
            fallback_bpm=args.fallback_bpm,
            fallback_downbeat=args.fallback_downbeat,
        )
    except Exception as exc:  # noqa: BLE001
        if args.song_id:
            try:
                mark_failed(args.song_id, str(exc), args.api_base)
            except Exception as status_exc:  # noqa: BLE001
                print(
                    f"warn: could not mark failed: {status_exc}",
                    file=sys.stderr,
                )
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(
        f"ok: wrote {output}  bpm={result['bpm']:.2f}  "
        f"moves={result['move_count']}  audio={result['audio']}  "
        f"report={result['report']}"
    )

    if args.song_id:
        if result["synthetic_timing"] and not args.allow_synthetic_cache:
            message = (
                "synthetic timing is not cache-ready by default; "
                "review the report or pass --allow-synthetic-cache"
            )
            try:
                mark_failed(args.song_id, message, args.api_base)
            except Exception as status_exc:  # noqa: BLE001
                print(f"warn: could not mark failed: {status_exc}", file=sys.stderr)
            print(f"error: {message}", file=sys.stderr)
            return 2
        try:
            upload_chart(
                args.song_id,
                output,
                audio_path=Path(result["audio"]),
                base_url=args.api_base,
            )
            print(f"cached chart on song {args.song_id} via {args.api_base}")
        except Exception as exc:  # noqa: BLE001
            try:
                mark_failed(args.song_id, str(exc), args.api_base)
            except Exception as status_exc:  # noqa: BLE001
                print(f"warn: could not mark failed: {status_exc}", file=sys.stderr)
            print(f"error: cache upload failed: {exc}", file=sys.stderr)
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
