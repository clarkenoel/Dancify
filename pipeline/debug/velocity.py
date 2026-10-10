#!/usr/bin/env python3
"""Velocity-curve debug view: motion energy + beat grid + hit markers.

Also writes a raw-vs-smoothed landmark overlay for one joint (left wrist).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# Allow running as `python debug/velocity.py` from pipeline/
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dancify_pipeline.pipeline import run_pipeline  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="Input video path")
    parser.add_argument(
        "--out",
        default="debug_out/velocity.png",
        help="Output PNG path",
    )
    parser.add_argument(
        "--json-out",
        default="debug_out/dance.json",
        help="Also write dance.json here",
    )
    args = parser.parse_args()

    out_png = Path(args.out)
    out_json = Path(args.json_out)
    work = out_png.parent / "_work"
    out_png.parent.mkdir(parents=True, exist_ok=True)

    result = run_pipeline(
        input_path=args.video,
        output_json=out_json,
        work_dir=work,
        save_audio=work / "audio.wav",
    )
    data = np.load(work / "debug_arrays.npz")
    times = data["times"]
    energy = data["energy"]
    hits = data["hits"]
    beats = data["beat_times"]
    raw = data["raw"]
    smoothed = data["smoothed"]

    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)

    ax = axes[0]
    ax.plot(times, energy, color="#1f4e79", label="motion energy", lw=1.5)
    for b in beats:
        ax.axvline(b, color="#cccccc", lw=0.6, zorder=0)
    for h in hits:
        ax.axvline(h, color="#c0392b", lw=1.2, alpha=0.85)
    # Red markers at musical hit times (on beat/half-beat after valley snap)
    ax.scatter(
        hits,
        np.interp(hits, times, energy),
        color="#c0392b",
        s=40,
        zorder=5,
        label="hits (valley→beat)",
    )
    ax.set_ylabel("energy")
    ax.set_title(
        f"Velocity curve — bpm={result['bpm']:.1f} moves={result['move_count']} "
        "(gray=beats, red=JD-style valley snaps)"
    )
    ax.legend(loc="upper right")

    # Left wrist (15) raw vs smoothed Y (image space, before normalize)
    ax2 = axes[1]
    joint = 15
    ax2.plot(times, raw[:, joint, 1], color="#888888", alpha=0.7, label="raw Y (wrist)")
    ax2.plot(times, smoothed[:, joint, 1], color="#27ae60", label="smoothed Y (wrist)")
    ax2.set_xlabel("time (s) — same timeline as video.currentTime")
    ax2.set_ylabel("landmark y")
    ax2.set_title("Raw vs smoothed overlay (left wrist)")
    ax2.legend(loc="upper right")

    fig.tight_layout()
    fig.savefig(out_png, dpi=140)
    print(f"wrote {out_png}")
    print(f"wrote {out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
