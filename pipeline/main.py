#!/usr/bin/env python3
"""CLI: video → dance.json (+ optional backend chart cache)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dancify_pipeline.cache import mark_failed, mark_processing, upload_chart
from dancify_pipeline.pipeline import run_pipeline


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
    parser.add_argument("--fps", type=float, default=30.0, help="Pose sample rate")
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

    output = Path(args.output)
    work_dir = Path(args.work_dir) if args.work_dir else output.parent / "_work"
    audio_out = Path(args.audio_out) if args.audio_out else work_dir / "audio.wav"

    if args.song_id:
        try:
            mark_processing(args.song_id, args.api_base)
        except Exception as exc:  # noqa: BLE001
            print(f"warn: could not mark processing: {exc}", file=sys.stderr)

    try:
        result = run_pipeline(
            input_path=args.input,
            output_json=output,
            work_dir=work_dir,
            target_fps=args.fps,
            save_audio=audio_out,
        )
    except Exception as exc:  # noqa: BLE001
        if args.song_id:
            try:
                mark_failed(args.song_id, str(exc), args.api_base)
            except Exception:  # noqa: BLE001
                pass
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(
        f"ok: wrote {output}  bpm={result['bpm']:.2f}  "
        f"moves={result['move_count']}  audio={result['audio']}"
    )

    if args.song_id:
        try:
            upload_chart(
                args.song_id,
                output,
                audio_path=Path(result["audio"]),
                base_url=args.api_base,
            )
            print(f"cached chart on song {args.song_id} via {args.api_base}")
        except Exception as exc:  # noqa: BLE001
            print(f"warn: cache upload failed: {exc}", file=sys.stderr)
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
