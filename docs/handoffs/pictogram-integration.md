# Illustrated target integration and color palettes

Scope: Lenny and Human in the existing web game, with a Target character selector.
No scoring, camera, timeline, API, BLE or chart-schema changes. Full screen design
integration remains separate.

## Source and provenance

Imported only art/rig/design files from `taliyadenis/justmakeit`:

- `feat/codex-pictogram-assets`, commit `627850afb98488221661ec76aa66dc50b3af40e0`:
  `assets/pictograms/` and the standalone demo under `docs/design/`.
- `feat/td-dancify-figma-handoff`, commit `ab7f74689cf9cd4835a14294ecb53ffcbd651505`:
  `docs/design/figma-handoff.md`.

Both deliveries were based on an older upstream main. Their application code was
not imported. Original PNG bytes, rig pivots and standalone renderer are unchanged.
The source manifest says these pivots are newly calibrated, not recovered Figma
joint metadata. Artist review remains necessary.

The PRD's original 100-unit SVG deliverable is a design proposal; the actual
handoff uses 23 full-canvas PNGs and a rig manifest. This integration adapts those
assets without asking the designer to redraw them.

## Runtime behavior

`web/src/pictograms/rig.ts` reads the artist's pivot/attachment metadata.
Source viewer-left follows anatomical right (12/14/16 and 24/26/28); viewer-right
follows anatomical left (11/13/15 and 23/25/27). Chart x/y already include aspect
normalization and are neither renormalized nor mirrored. Webcam mirroring remains
an independent display transform.

Each limb maps its original proximal pivot and distal attachment directly to the
checkpoint's two joints. Length scales along that bone; thickness follows torso
scale to avoid giant hands or thick legs when adapting Lenny's stylized proportions.
Torso maps hip/shoulder midpoints and shoulder width; its outline is an approximation
for differing hip/shoulder ratios. Head, open hands and feet are decorative neutral
pieces attached to their parent joints. No finger/head-direction inference or
continuous motion is fabricated. Stable layering avoids depth flicker; crossing
limbs use a fixed order rather than claimed depth reconstruction.

All transformed sprite bounds fit the target viewport. Each character uses 14
images, each at most 256px, with less than 3 MiB of decoded RGBA data per character.
Images load only when that character is selected and reuse a shared preload cache.
Generated runtime sprites retain source crop coordinates and SHA-256 provenance.
Vite hashes/bundles their URLs; there is no runtime Figma/external dependency.
The SVG is a drawing surface with a light system background so dark line art is
readable even over the dark video overlay; screen styling is deferred.

`PoseTarget` preloads the shared sprites with a five-second deadline. While loading,
on any asset failure, or with missing/degenerate projected geometry, it renders the
existing joint skeleton. A visible artwork-failure note explains the fallback.
A 3D-scorable limb may collapse in 2D; that is a display fallback, not a new chart
rejection or a scoring adjustment. Unmount cleanup prevents late load state updates.

The character selector and game-wide skeleton checkbox affect presentation props only. It does not
change the captured bundle, reference video, session epoch, results or camera.
Target selection and checkpoint windows still follow reference video time.

## Review and verification

- `npm test --prefix web`: includes endpoint accuracy, anatomical side mapping,
  crossing limbs, portrait/landscape consistency, bounds, asset provenance/budget,
  missing geometry and failed/hanging asset loads.
- `npm run build --prefix web`: TypeScript and production asset bundle.
- `node --test assets/pictograms/rig.test.mjs`: original designer rig invariants.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium bash web/scripts/test-integration.sh`
  on this Linux environment: prepares actual tracked video/music, exercises existing
  gameplay/camera/upload/recovery flows plus the new renderer, art failure and toggle.
  Other environments use their configured installed Playwright Chromium path.

At `/debug/pictograms.html` on the Vite development server, compare neutral, T,
one-arm-raised, crossed-arm and bent-knee diagnostic poses. Load real prepared
`dance.json` using the local file input to compare actual checkpoints. The page
reuses the same PoseTarget/adapter as gameplay and does not award scores. Captured
browser images are in ignored `web/test-results/pictogram-*.png` after tests.

## Remaining acceptance / next work

- Designer reviews actual rendered stretching, overlaps and pivots, especially
  crossed arms and bent knees at compact target size. Mathematical joint accuracy
  does not prove aesthetic quality or physical scoring calibration.
- User tests on the Windows/WSL demo machine, including camera round, replay,
  switching songs and the skeleton toggle.
- Apply the linked Figma screen/component design incrementally. Bundle the actual
  font files and OFL notices then; the handoff alone does not install fonts.
- Keep automatic initial readiness countdown, deliberate recovery confirmation,
  immediate results and the latest wearable behavior. The older Figma handoff is
  visual guidance, not authority to revert these working interactions.

## Verified in this implementation (2026-10-11)

- Initial integration: 115 frontend tests passed; TypeScript/Vite build passed.
- Browser: 12 tests passed, plus Chromium launch preflight. Actual eight-second
  video/music preparations each produced four checkpoints; all four rendered.
  Known-pose and real-preparation screenshots were visually inspected.
- Original artist rig: 8 tests passed. Launcher: 8 tests passed.
- Backend: 78 tests passed (run from `backend/`). Pipeline: 65 tests passed.
- Runtime sprite regeneration is byte-identical. All imported source PNGs and
  rig files match the designer commit. No new dependencies or schema edits.

The source torso has two long fixed side strokes. They remain intact with green
fill under the supplied palette; they are body decoration, not tracked arm segments.
Stretched joint outlines and stylized proportions still need aesthetic review.
The current work is local on `feat/codex-pictogram-integration`; no push or merge
was performed as part of implementation.


## Baked colors (2026-10-11)

The user's supplied Lenny color sheet defines the palette. Runtime Lenny uses
leaf green #69A958, green shade #4E8B49, cream #F5F0C5 and dark green #1D2E27.
Human uses blue #438FDC, blue shade #3374BD and dark navy outlines #182D49;
the original chest star remains. `web/src/pictograms/palette.json` also records
reference stem/flower colors for future artwork that contains those parts. No
flower/hat was added to the current rig.

`node web/scripts/bake-pictogram-colors.mjs` recreates clean small source crops,
closes open contours only for fill boundaries, paints interior regions, then
composites the original outline alpha. Source linework, crop coordinates, sprite
sizes and rig pivots remain registered. Temporary generated color drafts changed
shapes and are not used by the game. The baked game sprites come from the original
artist PNGs. The generator and Chromium are authoring tools; normal app startup
only loads the checked-in PNGs and requires no color generation.

Color/both-character checks include actual pixel colors and alpha backgrounds,
all joint endpoints on five known poses for both characters, character switching
without replacing/resetting the video, and independent per-character asset loading.
The selector also works in the diagnostic gallery. Open-contour seams and stretched
proportions remain visible in some poses and still warrant artist review.

Rendered palette previews: [Lenny](../design/lenny-color-preview.png) and
[Human](../design/human-color-preview.png). These are actual browser renders of the
checked-in sprites, not the discarded color-generation drafts.

Final color integration verification: 121 frontend tests, all 13 browser tests
(including real preparation/camera regression and baked pixel checks), Chromium
preflight, eight original rig tests, and the production build passed. Re-running
the complete bake command produces byte-identical output for both characters.
The baked PNGs and selector remain local on the feature branch; nothing was pushed
or merged during the color change.
