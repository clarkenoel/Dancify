# Pipeline — Agent Instructions

You are working on the prep pipeline only. Person A owns this directory.

## Scope

- Python only in this directory. Person A also owns `/backend` (local FastAPI + SQLite song cache).
- Do not touch `/web`, `/firmware`, or `/schema`.
- Output must match `dance.schema.json` exactly.
- After a successful run, cache the chart via `PUT /songs/{id}/chart` on the song-cache API so the game can skip recompute (see `backend/README.md` and `PRD.md` §7).

## Commands

- Run tests: `pytest tests/ -v`
- Run pipeline: `python main.py --input <video> --output dance.json`
- Debug view: `python debug/velocity.py <video>`
- Song cache API: `cd ../backend && uvicorn app.main:app --reload --port 8000`

## Rules

- Joint smoothing is a first-class deliverable. Verify raw vs. smoothed side-by-side.
- Primary subject isolation must track the same person across the full video.
- Never write a `dance.json` that doesn't validate against the schema.
- Velocity-curve debug view is not optional. It's the only way to diagnose the pipeline.
- Prefer reading a cached chart from `/backend` when `status=ready` instead of re-running the model.

## Session Start

Confirm you are in `/pipeline`. Read `PRD.md` §4.1 for the full pipeline spec.