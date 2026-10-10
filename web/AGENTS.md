# Web — Agent Instructions

You are working on the game frontend only. Person B owns this directory.

## Scope

- TypeScript/React only. Do not touch `/pipeline`, `/firmware`, `/backend`, or `/schema`.
- `WearableClient.ts` is the only module that touches Web Bluetooth.
- Read `dance.json` — never write it. Prefer loading ready bundles from the local song-cache API (`http://127.0.0.1:8000`, see `backend/README.md` / `PRD.md.md` §7).
- **Handoff from Person A:** read [`../pipeline/WEB_HANDOFF.md`](../pipeline/WEB_HANDOFF.md) and [`../pipeline/NORMALIZATION.md`](../pipeline/NORMALIZATION.md) — load `GET /songs/{id}/video`, `/chart`, and `/audio`, then normalize live poses identically before compare.
- You may **call** `/backend` HTTP endpoints; do not rewrite the backend. POST play results to `/songs/{id}/plays` after a run.

## Commands

- Dev server: `npm run dev`
- Tests: `npm test`
- Build: `npm run build`

## Rules

- Master clock is the reference `<video>` element's `currentTime`; never run a
  separate audio element as a competing clock.
- Pose comparison returns `null` for insufficient data.
- Keyboard fallback always works.
- Build `WearableClient.ts` against a fake event source (Phase 1). Real BLE swap in Phase 3.

## Figma MCP

You have access to the Figma MCP server. Use it to:

1. **Read designs** before writing component code. Pull actual variables, components, and layout from Figma rather than guessing.
2. **Generate code** that uses the design system's components and tokens, not hardcoded values.
3. **Write back to Figma** when the code diverges from the design (if `/prototype-to-figma` skill is available).

### Rules

- Never hardcode colors, spacing, or typography. Pull from Figma variables.
- Before building a screen, fetch the Figma frame and read its structure.
- Keep Figma node links in code comments so future agents can trace back to the source.
- Name layers in Figma clearly (outside-in structure) so Codex can parse them.

## Session Start

Confirm you are in `/web`. Read `PRD.md.md` §4.2 for the game spec.