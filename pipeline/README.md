# Dancify prep pipeline

Offline: **video → `dance.json` + audio**, then optionally cache on the song-cache API.

## Supported MVP input

- CPython **3.10–3.12**
- One continuously visible primary dancer
- Constant-frame-rate (CFR) video with a stable camera/timeline
- Short clips; multi-person identity tracking is **not implemented**

The pipeline rejects missing/unstable pose tracking rather than emitting zero
targets. Multi-person isolation, angular-velocity energy, and hold merging are
explicitly deferred; current energy is confidence-masked normalized landmark
speed and every move has `is_hold=false`.

Serialized checkpoints must pass the browser scoring contract: all twelve
gameplay joints at visibility >= 0.35 with usable torso and limb geometry.
This target requirement is separate from the existing frame-continuity gate.
Shared acceptance examples live in `fixtures/scorable-targets.json`; Python,
backend and browser tests must agree on them.
Unscorable selected checkpoints are omitted, without substituting other poses.
The report's `checkpoint_quality` records selected, retained and omitted counts;
the game displays omissions. Preparation fails if no usable checkpoints remain.

## Setup

```bash
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

System deps: `ffmpeg` (and `ffprobe`).

## Run

```bash
python main.py --input testdata/sample.mp4 --output outputs/dance.json
```

This writes:

- `outputs/dance.json` — frozen gameplay schema
- `outputs/dance.report.json` — timing/tracking/readiness sidecar
- `outputs/_work/audio.wav` — zero-based audio normalized to the video duration

URL ingest (when yt-dlp works on your machine):

```bash
python main.py --input 'https://www.youtube.com/watch?v=VIDEO_ID' --output outputs/dance.json
```

Downloads use URL-keyed filenames and overwrite stale content.

Mute/silent input requires an explicit BPM and first downbeat:

```bash
python main.py -i testdata/mute.mp4 -o outputs/dance.json \
  --fallback-bpm 120 --fallback-downbeat 0
```

That chart's report marks `timing.synthetic=true` and
`readiness.cache_ready_by_default=false`.

Cache to backend (server must be running on :8000):

```bash
python main.py --input testdata/sample.mp4 --output outputs/dance.json --song-id <UUID>
```

Cache state validation is fail-fast. Synthetic-timing charts are marked failed
instead of uploaded unless a human explicitly passes `--allow-synthetic-cache`.

## Clean-checkout demo

The end-to-end demo seed uses the tracked `testdata/Video_1.mp4` and
`testdata/audio_1.m4a`, muxes them on the video master timeline, runs this
pipeline with real audio, and uploads the complete bundle to the local backend:

```bash
# after creating backend/.venv and pipeline/.venv and starting the backend
cd ..
bash backend/scripts/bake_demo_songs.sh
```

See [`../backend/README.md`](../backend/README.md#reproducible-demo-seed-clean-checkout)
for the complete fresh-checkout command. Generated media and charts are
temporary and are not committed.

## Debug (required gate)

```bash
python debug/velocity.py testdata/sample.mp4 --out debug_out/velocity.png
python debug/tracking_video.py testdata/sample.mp4 \
  --out debug_out/tracking.mp4 \
  --json-out debug_out/dance.json
```

Gray lines = beats, red = snapped hits, orange × = selected valley frames, and
shading = invalid tracking. A chart is not demo-ready if tracking gaps dominate,
orange valleys are implausible, or synthetic timing has not been reviewed.

Tracking diagnostics are written before continuity rejection:

- `dance.tracking.json` — exact invalid frame/time ranges and frame-level reasons
- `dance.tracking.mp4` — original footage with detected skeleton, confidence,
  and validation reason (generated automatically on tracking failure)
- `_work/debug_arrays.npz` — raw/interpolated/smoothed arrays and masks

Short bounded gaps (about 100ms) may be interpolated. Long gaps are never filled
with invented poses. They produce no checkpoints and can make footage
unsupported when the continuity gate fails.

## Smoke clip

See [`testdata/SOURCE.md`](testdata/SOURCE.md). YouTube/TikTok downloads were bot-blocked in the build environment; the checked local sample is a ≤20s portrait single-dancer clip with music (Shorts-shaped). `*.mp4` is gitignored — rebuild notes are in SOURCE.md.

## Contracts / web handoff

- Frozen schema on disk: `../schema/dance.schema.json.json` (legacy double
  extension).
- Normalization: [`NORMALIZATION.md`](NORMALIZATION.md).
- **Person B start here:** [`WEB_HANDOFF.md`](WEB_HANDOFF.md) — how to load the
  complete `/video` + `/chart` + `/audio` bundle, post plays, and match landmark
  space.
- Audio is a **sidecar WAV** (schema has no audio field). All chart times use the
  same zero-based timeline as the reference `HTMLVideoElement.currentTime`.

## Hit density (Just Dance calibration)

Valley-first: find valid motion-energy dips, snap to beat/half-beat if close,
and thin to ~every **2 whole beats**. Flat/unusable motion returns no chart.
See [`CALIBRATION.md`](CALIBRATION.md).

## Layout

```
pipeline/
  main.py
  dancify_pipeline/   # stages
  debug/velocity.py
  NORMALIZATION.md
  testdata/           # gitignored media + SOURCE.md
```
