# Phase <N> Handoff — <area>

**From:** <Person>
**To:** <Person or team>
**Date:** <H<N>>
**Phase gate:** <which gate from PRD §10>

---

## What Changed

<One paragraph.>

## Where

- `/pipeline/main.py` — entry point
- `/pipeline/test_data/` — test videos + expected outputs

## How It Was Verified

- `pytest tests/` — 12 passed
- Manual: <what you did>

## What Works

- <bullet>

## What Doesn't Work Yet

- <bullet>

## Risks

- <bullet>

## Next Steps for the Receiver

- <bullet>

## Schema Changes

- None. `dance.schema.json` unchanged.

## Rebase Notes

- Safe to rebase on `main`.