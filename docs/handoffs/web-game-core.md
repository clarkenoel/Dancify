# Web game core handoff

Implemented on `feat/codex-web-game-core`, based on `b740ea4`.
The frozen schema is unchanged. Backend changes are the integration fixes
authorized when taking over the previous agent's work.

## Delivered

- React/TypeScript/Vite development harness with logic isolated from design.
- URL/upload preparation, optional range, progress/retry, diagnostic links,
  reconnect after reload, and actionable upload fallback.
- Validated, immutable bundle selection with legacy-normalization rejection.
- Reference-video clock, embedded music, pause/buffering/seek/replay handling,
  and stale-inference rejection. Seeking makes the segment unrecordable until replay.
- Local MediaPipe webcam tracking, Python normalization parity, checkpoint scoring,
  explicit LOST, coverage/accuracy, and separate keyboard-practice results.
- Keyboard controls, fake wearable controls (no scoring), local result outbox,
  history, and server-side idempotent result submission.
- Required report quality/normalization metadata, beat/BPM/aspect consistency,
  fixed media-duration tolerance, and manual-vs-worker provenance.
- Preparation worker fix: preserve the venv interpreter path; resolving its
  symlink had executed system Python without MediaPipe.

## Verification

- Backend: 52 tests passed, including report failures preserving old bundles,
  legacy regeneration, idempotent results, and venv interpreter regression.
- Pipeline baseline: 39 tests passed; pipeline source was not changed.
- Web core: 21 tests passed (pose golden vectors, scoring epochs, tracking loss,
  keyboard isolation, validation, pinned bundles, polling cancellation and outbox).
- Chromium integration: real MP4 decoding, pause/seek/replay, keyboard scoring,
  lost-response save retry, local model inference from a recorded dancer supplied
  through a simulated webcam, and actual camera-track cleanup all passed.
- Browser upload form completed an actual eight-second preparation, loaded its
  immutable bundle, and verified worker provenance. Provider-failure fallback UI
  passed using a deterministic mocked download failure.
- Real YouTube preparation was attempted here and returned `download_failed`.
  The feature remains exposed; access/authentication is environment-dependent.
- Backend API smoke passed with generated media and an explicitly manual report.
- Reviewed 0–59.5s canonical seed passed: 28 moves, 1478/1488 valid frames (99.3%),
  longest dropout 0.36s. Inspected a skeleton overlay from saved inference arrays.
  The 60.8s source frame is a promotional multi-coach collage/end card, confirming
  that excluded footage is outside the solo-dancer contract.
- Production build and repeatable npm installation/model setup passed.

## Model distribution

The browser uses official `@mediapipe/pose@0.5.1675469404`, complexity 1, rather
than Tasks Vision with a separately downloaded model. Its full weights are
byte-identical to Python MediaPipe 0.10.18's model:
`e9a5c5cb17f736fafd4c2ec1da3b3d331d6edbe8a0d32395855aeb2cdfd64b9f`.
The npm lockfile verifies package integrity; setup verifies this model checksum
and copies assets locally. Camera tests made no external asset/frame requests.
Graph/runtime and smoothing differences still need real-player calibration.

## Working environment

Current development API: port 8001 with isolated `backend/data/web-development/`.
Current Vite: port 5173 with ignored `.env.local` selecting that API. Both bind
only to loopback. Existing backend data is preserved. See `web/README.md` for
portable setup, browser test commands, module boundaries and session semantics.

## Remaining human/design work

- Run a physical-webcam playthrough on the demo computer to calibrate provisional
  angle/limb weights, thresholds, camera framing and latency. Automated recorded
  media inference is not a human usability/calibration trial.
- Connect Figma frames/tokens and finished assets to the hooks in `web/src/hooks`.
  The current native-control harness is deliberately unstyled.
- Real BLE hardware, continuous choreography, holds and exact hit timestamps
  remain outside this implementation. The timing RFC is still unimplemented.
- Synthetic-timing charts are not accepted for scored play by this web workflow;
  use audible music and regenerate older charts. A manual valid report does not
  prove that uploaded media/chart contents originated together.
- Full URL-provider access must be checked on the player's own computer; bot
  failures continue to offer upload. Credentials stay outside source and chat.

No deployment, publication, push, or schema unfreeze was performed.

## Subsequent planned webcam work (2026-10-10)

The approved [webcam/player-lock plan](../plans/webcam-player-lock.md) adds explicit
controller/keyboard pairing, multi-person body tracking and session-only local
face matching to maintain one scored player when spectators enter. It is planned,
not part of the delivered single-person runtime or the verification above.
Identity uncertainty pauses playback and scoring; no silent handoff is allowed.
Face data never enters backend storage, results, logs or persistent browser
storage. Frozen contracts and the solo-dancer preparation boundary remain intact.
