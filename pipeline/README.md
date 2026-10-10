# Dancify prep pipeline

Offline: **video → `dance.json` + audio**, then optionally cache on the song-cache API.

## Setup

```bash
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

System deps: `ffmpeg` (and `ffprobe`).

## Run

```bash
python main.py --input testdata/sample.mp4 --output outputs/dance.json
```

URL ingest (when yt-dlp works on your machine):

```bash
python main.py --input 'https://www.youtube.com/watch?v=VIDEO_ID' --output outputs/dance.json
```

Cache to backend (server must be running on :8000):

```bash
python main.py --input testdata/sample.mp4 --output outputs/dance.json --song-id <UUID>
```

## Debug (required gate)

```bash
python debug/velocity.py testdata/sample.mp4 --out debug_out/velocity.png
```

Gray lines = beats, red = hits. If red markers don’t sit in energy dips on the beat grid, the chart is not demo-ready even if JSON validates.

## Smoke clip

See [`testdata/SOURCE.md`](testdata/SOURCE.md). YouTube/TikTok downloads were bot-blocked in the build environment; the checked local sample is a ≤20s portrait single-dancer clip with music (Shorts-shaped). `*.mp4` is gitignored — rebuild notes are in SOURCE.md.

## Contracts / web handoff

- Schema file on disk: `../schema/dance.schema.json.json` (double extension).
- Normalization: [`NORMALIZATION.md`](NORMALIZATION.md).
- **Person B start here:** [`WEB_HANDOFF.md`](WEB_HANDOFF.md) — how to `GET /songs/{id}/chart` + `/audio`, post plays, and match landmark space.
- Audio is a **sidecar WAV** (schema has no audio field). Backend: `GET /songs/{id}/audio`.

## Hit density

Hits are chosen **on whole beats** (~every **2 beats** by default) by scoring energy valleys near the beat grid — not “every local dip.” Gate with the velocity plot before handing charts to web.

## Layout

```
pipeline/
  main.py
  dancify_pipeline/   # stages
  debug/velocity.py
  NORMALIZATION.md
  testdata/           # gitignored media + SOURCE.md
```
