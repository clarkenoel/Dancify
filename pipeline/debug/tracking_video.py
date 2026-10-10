#!/usr/bin/env python3
"""Render source footage with pose confidence and tracking gate reasons."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dancify_pipeline.diagnostics import render_tracking_video  # noqa: E402
from dancify_pipeline.pipeline import run_pipeline  # noqa: E402
from dancify_pipeline.tracking import (  # noqa: E402
    TrackingQualityError,
    frame_tracking_breakdown,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write an annotated tracking diagnostic video"
    )
    parser.add_argument("video", help="Input reference video")
    parser.add_argument(
        "--out",
        default="debug_out/tracking.mp4",
        help="Annotated MP4 output",
    )
    parser.add_argument(
        "--json-out",
        default="debug_out/dance.json",
        help="Chart path used to name report/diagnostic sidecars",
    )
    args = parser.parse_args()

    output = Path(args.out)
    chart = Path(args.json_out)
    work = output.parent / "_tracking_work"
    failure: TrackingQualityError | None = None
    try:
        run_pipeline(
            input_path=args.video,
            output_json=chart,
            work_dir=work,
            save_audio=work / "audio.wav",
        )
    except TrackingQualityError as exc:
        failure = exc

    arrays = np.load(work / "debug_arrays.npz")
    smoothed = arrays["smoothed"]
    render_tracking_video(
        Path(args.video),
        output,
        times=arrays["times"],
        landmarks=arrays["raw"],
        confidence=arrays["frame_confidence"],
        breakdown=frame_tracking_breakdown(smoothed),
    )
    tracking_json = chart.with_name(f"{chart.stem}.tracking.json")
    print(f"wrote {output}")
    print(f"wrote {tracking_json}")
    if failure is not None:
        print(f"tracking rejected: {failure}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
