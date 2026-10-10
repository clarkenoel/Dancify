# Dancify

A Just Dance clone that works on any dance video.

## What it does

Paste a TikTok or YouTube link, wait two minutes while the pipeline extracts the beat and hit moments, then play a rhythm game where your webcam tracks your body and a custom ESP32 wearable clicks the beat on your wrist.

## Repo structure

- `/pipeline` — Python prep pipeline (video → `dance.json`)
- `/backend` — Local FastAPI + SQLite song cache (clips, cached charts, play history; no auth)
- `/web` — TypeScript/React game
- `/firmware` — ESP32 wearable firmware
- `/assets/pictograms` — SVG pictogram parts (artist-drawn)
- `/schema` — Frozen contracts (do not edit without approval)
- `/docs` — Demo script, handoffs

## Setup

See `PRD.md` and `TEAM.md`. The pipeline needs Python 3.10+, FFmpeg, and `librosa`/`mediapipe`. The song-cache API needs Python 3.10+ (`backend/requirements.txt`). The game needs Node 18+. The firmware needs the Arduino IDE with the ESP32 board package.

**Backend note:** We intentionally run a small local API so songs and pipeline outputs can be stored once and reused (saves compute) and so play history sticks to each song. Stack: **FastAPI + SQLite + files under `backend/data/`**. No user auth. Details in `backend/README.md` and `PRD.md` §7.

## Run

Pipeline: `python pipeline/main.py --input <video> --output dance.json`
Backend: `cd backend && uvicorn app.main:app --reload --port 8000`
Game: `cd web && npm install && npm run dev`
Firmware: flash `firmware/wearable.ino` to an ESP32.

## Documentation

- `PRD.md` — product spec and roadmap
- `AGENTS.md` — rules for AI coding agents
- `TEAM.md` — ownership and git discipline
- `schema/` — frozen contracts
