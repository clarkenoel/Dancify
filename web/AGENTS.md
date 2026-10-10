# Web — Agent Instructions

You are working on the game frontend only. Person B owns this directory.

## Scope

- TypeScript/React only. Do not touch `/pipeline`, `/firmware`, or `/schema`.
- `WearableClient.ts` is the only module that touches Web Bluetooth.
- Read `dance.json` — never write it.

## Commands

- Dev server: `npm run dev`
- Tests: `npm test`
- Build: `npm run build`

## Rules

- Master clock is `video.currentTime`.
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

Confirm you are in `/web`. Read `PRD.md` §4.2 for the game spec.