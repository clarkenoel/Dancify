# Web — Agent Instructions

You are working on the game frontend only. Person B owns this directory.

## Scope

- TypeScript/React only. Do not touch `/pipeline`, `/firmware`, `/backend`, or `/schema`.
- `WearableClient.ts` is the only module that touches Web Bluetooth.
- Read `dance.json` — never write it. Load the API base URL from configuration
  (`VITE_DANCIFY_API_URL`, default `http://127.0.0.1:8000`) and prefer immutable
  ready bundles (see `backend/README.md` / `PRD.md.md` §7).
- **Handoff from Person A:** read [`../pipeline/WEB_HANDOFF.md`](../pipeline/WEB_HANDOFF.md) and [`../pipeline/NORMALIZATION.md`](../pipeline/NORMALIZATION.md) — load `GET /songs/{id}/video`, `/chart`, and `/audio`, then normalize live poses identically before compare.
- You may **call** `/backend` HTTP endpoints; do not rewrite the backend. POST play results to `/songs/{id}/plays` after a run.
- Follow [`../docs/handoffs/gameplay-integration-contract.md`](../docs/handoffs/gameplay-integration-contract.md) for checkpoint, bundle-version, seek/replay, and delayed-inference behavior.

## Commands

- Dev server: `npm run dev`
- Tests: `npm test`
- Build: `npm run build`

## Rules

- Master clock is the reference `<video>` element's `currentTime`; never run a
  separate audio element as a competing clock.
- Pose comparison returns `null` for insufficient data.
- Camera-only gameplay: no keyboard scoring/practice mode or global gameplay shortcuts. Keep keyboard menu/button accessibility. Camera failures offer retry/menu exit; wearable failures may continue without a controller, still using the camera.
- Planned webcam player lock follows [`../docs/plans/webcam-player-lock.md`](../docs/plans/webcam-player-lock.md). It is not shipped: do not claim the single-person runtime preserves identity in crowds.
- When implementing player lock, keep session face descriptors in browser memory only; never persist, upload or log them. Ambiguous identity pauses video/scoring, never silently switches players. Preserve frozen chart/BLE contracts.
- WearableClient owns BLE input/output and the command simulator. Preserve the re-frozen 2026-10-11 protocol; wearableFeedback follows video time and finalized judgments without changing scores. Physical ESP32 timing remains unverified.

## Figma MCP

Read [`../design.md`](../design.md) before visual changes. Shared styles and bundled
fonts live in `src/styles.css` and `src/assets/fonts/`. Record the Figma revision
and distinguish verified component measurements from provisional demo styling.

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