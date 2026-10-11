# Dancify

A Just Dance-style rhythm game for dance videos.

## What it does

The product vision is to paste a TikTok or YouTube link, prepare a chart, and
play with webcam tracking plus an ESP32 wearable. The shipped prep MVP currently
supports short, stable, solo-dancer constant-frame-rate (CFR) clips. See
[`pipeline/README.md`](pipeline/README.md) for supported inputs and deferred
pipeline features.

## Repo structure

- `/pipeline` — Python prep pipeline (video → `dance.json`)
- `/backend` — Local FastAPI + SQLite song cache (clips, cached charts, play history; no auth)
- `/web` — TypeScript/React game
- `/firmware` — ESP32 wearable firmware
- `/assets/pictograms` — SVG pictogram parts (artist-drawn)
- `/schema` — Frozen contracts (do not edit without approval)
- `/docs` — Demo script, handoffs

## Setup

See `PRD.md.md` for the product vision and roadmap, and `AGENTS.md.md` for
ownership and repository rules. The pipeline needs Python 3.10+, FFmpeg, and
`librosa`/`mediapipe`. The song-cache API needs Python 3.10+
(`backend/requirements.txt`). The web game needs Node 22.12+ (see `web/README.md`); the planned
firmware needs the Arduino IDE with the ESP32 board package.

**Backend note:** We intentionally run a small local API so songs and pipeline outputs can be stored once and reused (saves compute) and so play history sticks to each song. Stack: **FastAPI + SQLite + files under `backend/data/`**. No user auth. Details in `backend/README.md` and `PRD.md.md` §7.

## Run

Pipeline: `python pipeline/main.py --input <video> --output dance.json`
Backend: `cd backend && uvicorn app.main:app --reload --port 8000`
Game: `cd web && npm ci && npm run dev` (local backend required; see `web/README.md`).
Firmware: not yet scaffolded in this repository.

## Documentation

- `PRD.md.md` — product vision, target architecture, and roadmap
- `AGENTS.md.md` — ownership, git discipline, and rules for AI coding agents
- `pipeline/README.md` — shipped prep MVP and supported inputs
- `pipeline/WEB_HANDOFF.md` — complete video/chart/audio browser handoff
- `schema/` — frozen contracts

## One-window local startup

Use the [Windows/WSL2 launcher](LAUNCHER.md) to start both services and open the
browser. After prerequisites are installed, run `bash scripts/setup.sh` once and
`bash scripts/start.sh` for daily use, or use the Windows double-click entry points.
