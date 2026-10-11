# Approved screen integration — 2026-10-11

The user's PNG export, `Dancify · Roller Rink Redesign.zip`, is the visual
reference: 30 dark states and three light examples at 1440 × 900. The main
menu, gameplay, and paused screens have light examples. This replaces the
previous interpretation of the handoff as styling on the developer demo.

Before adding a screen or changing an approved layout, show a visual preview
and wait for the user's acceptance or requested adjustments. The exported
screens themselves are approved for implementation. Do not merge to main.

## Current implementation

- Main menu follows the exported composition, paired actions, status badge,
  and dark/light controls. Theme preference persists locally when available.
- Star presentation thresholds: 20%, 35%, 50%, 65%, 85%. No stars for incomplete
  or seeked rounds, invalid accuracy, or missing comparable tracking. Zero
  stars below 20%. This does not change pose matching, points, or accuracy.
  The helper is tested; the results presentation is not yet connected.
- Remaining library, camera setup, gameplay, history and results layouts
  still need conversion. Existing controls remain available during migration.

## Approved additions / pending artwork

Static proposals were shown for Advanced import (title and clip range),
Settings (camera, volume, character, skeleton), and Developer tools
(movement logs, controller simulation, command/chart diagnostics).
The user approved all three previews. Advanced is now on import; Settings and
Developer tools are separate modal screens that preserve the mounted video and
camera. Opening them pauses/cancels countdown; returning does not auto-resume.
Developer tools is also available outside a round for controller testing.
Simulator navigation is scoped to the open screen, just like real rotary input.
Title is optional and defaults to the upload filename or URL hostname. Hidden
invalid range fields are revealed by native form validation.

Transparent source exports for decorative stars and rating-star artwork are
still needed. Flattened screen PNGs are visual references, not runtime UI.
Do not invent replacements or show illustrative Figma scores as real results.

## Validation

After connecting the approved additions: 132 unit tests passed, TypeScript and
production build passed, browser launch preflight passed, and all 18 browser
scenarios passed together against a fresh local API/database. The browser suite
uses real preparation and the actual MediaPipe model with a recorded camera
fixture. It includes import validation, camera lifecycle, immediate results and
replay, BLE feedback/recovery, modal focus, preserved media/settings, and artwork
fallback. Physical ESP32 testing remains separate. Nothing pushed or merged.
