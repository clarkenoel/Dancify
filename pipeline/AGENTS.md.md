# Pipeline — Agent Instructions

You are working on the prep pipeline only. Person A owns this directory.

## Scope

- Python only in this directory. Coordinate `/backend` changes with its owner.
- Do not touch `/web`, `/firmware`, or `/schema`.
- Output must match `dance.schema.json` exactly.
- Cache only when the run report says `cache_ready_by_default=true`; synthetic
  timing requires explicit human override.

## Commands

- Run tests: `pytest tests/ -v`
- Run pipeline: `python main.py --input <video> --output dance.json`
- Debug view: `python debug/velocity.py <video>`
- Song cache API: `cd ../backend && uvicorn app.main:app --reload --port 8000`

## Rules

- Joint smoothing is a first-class deliverable. Verify raw vs. smoothed side-by-side.
- The current MVP accepts stable solo CFR clips only. Reject unstable tracking;
  multi-person identity isolation is deferred.
- Current motion energy is confidence-masked normalized landmark speed.
  Angular energy and hold merging are deferred and must not be claimed.
- Never write a `dance.json` that doesn't validate against the schema.
- Velocity-curve debug view is not optional. It's the only way to diagnose the pipeline.
- Prefer reading a cached chart from `/backend` when `status=ready` instead of re-running the model.

## Session Start

Confirm you are in `/pipeline`. Read `PRD.md` §4.1 for the full pipeline spec.