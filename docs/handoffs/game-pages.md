# First-draft game pages and camera-only play

## Scope and sources

New work lives on `feat/codex-game-pages`. The design baseline is the designer
handoff at `taliyadenis/justmakeit@ea39c042507fec5a8040660a9c5393ee1c530c69`
and the root [design guide](../../design.md). Direct Figma canvas access was
unavailable. This is an implementation of the documented direction, not a
pixel-verified reproduction of the latest frames.

The main menu, library, import form, game view, countdown, confirmation dialogs,
and results use the shared palette and locally bundled Bungee Inline/Jersey 25
fonts. Menu actions are centered and enlarged. Control geometry and dimensions
are provisional pending designer review. Font source hashes and OFL licenses
are in `web/src/assets/fonts/`.

The star PNGs have not been exported from Figma. Loading uses an indeterminate
native progress indicator, and results show actual numeric scores without
invented star thresholds. The existing character sprites remain unchanged.

## Product change

The user explicitly removed keyboard gameplay on 2026-10-11. New sessions score
only webcam poses. Keyboard practice, hit buttons, Enter-to-score, and global
Space/R/arrow gameplay shortcuts are removed. Keyboard focus and native menu/button
activation remain for accessibility; they never supply score samples.

A camera is required to play. Permission/startup/tracking failures offer retry or
return to menus. Controller disconnect pauses playback and offers reconnect or
Continue without controller; both retain the camera readiness gate. Legacy
keyboard-practice history and outbox records remain readable/retryable without
changing backend schemas or rewriting old scores.

This supersedes older keyboard-fallback instructions and prototype screens.
Score thresholds, reference-video timing, inference watchdogs, and pose
normalization are unchanged. No multi-person identity support is claimed.

## Editing and validation

Shared styling is in `web/src/styles.css`; screen composition is in App and the
existing game components. UI state does not replace the mounted reference video
when opening diagnostics, adjusting volume, or changing target artwork.

Browser regressions use the real preparation API, tracked media, and local camera
model. Empty/error UI fixtures are explicitly isolated boundary tests. Scoring
and wearable unit tests use comparable pose fixtures, not a production keyboard
hit route. Use the Windows teammate checklist to assess physical camera tracking,
button readability from the dance position, and visual proportions.

## Validation in this environment

- 119 frontend unit tests and TypeScript/Vite production build passed.
- All 15 browser scenarios passed together on the final layout (3.5 minutes),
  including real-model automatic countdown, timeout recovery, camera replacement,
  full rounds/replay, controller recovery, artwork fallback, and responsive pages.
  The browser launch preflight also passed. No runtime scoring gate or timeout
  was relaxed.
- Real preparation produced four-checkpoint bundles; a camera-fixture round
  produced a computed score and immediate results despite an injected save error.
- Reviewed main-menu desktop and mobile-import screenshots; responsive boundary
  tests cover both Figma sizes, a 390px window, long titles, and bundled fonts.
- Physical Windows camera/ESP32 trials, designer sign-off, and scoring calibration
  remain external acceptance work. The new pages are not merged to main.

## Merge boundary and CI limitation

Only the design guide is being merged separately. The character integration PR
(#7) has intermittent GitHub real-camera test failures: the software-rendered
model can exceed the production 2.5-second inference deadline during startup.
One duplicate run passes while another stops safely before automatic playback.
A longer overall test budget covers multiple bounded recovery phases but does
not resolve startup performance. No failed check was bypassed or runtime watchdog
weakened. Resolve this CI reliability issue before merging the combined feature
branch; local browser success does not establish a green GitHub check for pages.
