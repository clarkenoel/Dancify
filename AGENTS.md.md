# AGENTS.md.md — Dancify

Read `PRD.md.md` (product vision and roadmap) and this file (ownership + git)
before any work.

## Project

Dancify's product vision turns dance videos into a playable rhythm game. The
current prep MVP accepts short, stable solo CFR clips. Four parts:
- `/pipeline` — Python prep pipeline (video → `dance.json`)
- `/backend` — Local FastAPI + SQLite song cache (clips, cached charts, play history; **no auth**)
- `/web` — TypeScript/React game (plays `dance.json` with webcam scoring)
- `/firmware` — ESP32 wearable (joystick + piezo, BLE, no scoring contribution)

Build order: vision first, hardware later. See `PRD.md.md` §3.

## Hard Rules (Never Violate)

1. The reference `<video>` element's `currentTime` is the master clock. Not `performance.now()`, not `AudioContext`, and not a separately playing audio element.
2. Pose comparison returns `null` for insufficient data, never `0`.
3. Piezo uses LEDC peripheral, never `tone()`.
4. Joystick ADC pins must be ADC1 (GPIO 32–39). Never ADC2.
5. Keyboard fallback must always work.
6. The wearable never contributes to the score.
7. Camera frames never leave the browser.
8. No **cloud** backend, no auth/accounts, no cloud inference, no model training. The local `/backend` FastAPI + SQLite song cache **is allowed** (see `PRD.md.md` §7 and `backend/README.md`).
9. The game loop never imports from `/firmware`.
10. Never edit `/schema` without an explicit "unfreeze the schema" instruction.

## Directory Ownership

| Directory | Owner | Rule |
|---|---|---|
| `/pipeline` | Person A | Edit only here |
| `/backend` | Person A | Song/chart/play-history API; web may call it, not rewrite it |
| `/web` | Person B | Edit only here |
| `/firmware` | Person C | Edit only here |
| `/assets/pictograms` | Person D | Edit only here |
| `/schema` | Integrator | FROZEN — never edit |
| `/docs` | Integrator | Edit only here |
| Root files | Integrator | Never edit without asking |

If you need a change outside your directory, stop and tell the human.

## Frozen Contracts

- `schema/dance.schema.json.json` — interface between A and B (legacy double extension)
- `wearable.protocol.md` — interface between B and C
- `schema/type.ts` — TS mirror, changes with schema in same commit

## Git

- `main` is integrator-only. Never merge your own PR.
- Branch: `feat/<initials>-<thing>` or `fix/<initials>-<thing>`
- Branches live <4 hours. Rebase on `main` before every push.
- Squash-merge PRs. Never force-push `main`.
- Never commit: `node_modules`, `dist`, `.venv`, media files, `.env`

## Stop and Ask Before

- Editing `/schema` (any file)
- Editing outside your directory
- Adding a dependency
- Changing the master clock source
- Changing pose comparison return semantics
- Touching the BLE protocol
- Breaking keyboard fallback

## Do Without Asking

- Fix failing tests
- Add tests for a bug just fixed
- Add type hints where missing
- Write debug scripts in `/pipeline/debug/` or `/web/debug/`

## Code Conventions

- Prefer whole-file rewrites over snippets.
- Write tests for invariants, not just features.
- No new dependencies without asking.
- Plain English. No emoji in code or comments.
- No apology paragraphs. One sentence max, then move on.

## Session End

1. Run the test suite. Report pass/fail explicitly.
2. Summarize changes file by file.
3. Flag anything half-finished.
4. If a phase gate passed, write a handoff in `/docs/handoffs/`.

## Session Start

1. Confirm which phase we're in (ask if unclear).
2. Confirm which directory you're working in.
3. Read relevant source files end to end before editing.