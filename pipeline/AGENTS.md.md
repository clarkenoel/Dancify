# Pipeline — Agent Instructions

You are working on the prep pipeline only. Person A owns this directory.

## Scope

- Python only. Do not touch `/web`, `/firmware`, or `/schema`.
- Output must match `dance.schema.json` exactly.

## Commands

- Run tests: `pytest tests/ -v`
- Run pipeline: `python main.py --input <video> --output dance.json`
- Debug view: `python debug/velocity.py <video>`

## Rules

- Joint smoothing is a first-class deliverable. Verify raw vs. smoothed side-by-side.
- Primary subject isolation must track the same person across the full video.
- Never write a `dance.json` that doesn't validate against the schema.
- Velocity-curve debug view is not optional. It's the only way to diagnose the pipeline.

## Session Start

Confirm you are in `/pipeline`. Read `PRD.md` §4.1 for the full pipeline spec.