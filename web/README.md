# Dancify web game core

React/TypeScript game logic with an unstyled development interface. Figma components
can replace the interface without changing preparation, playback, or scoring.
The frozen chart schema is unchanged.

## Run on the player's computer

Prerequisites: Node >=22.12, Python 3.10–3.12, FFmpeg, and the backend/pipeline
virtual environments described in their READMEs.

```bash
# Terminal 1, repository root. One local backend worker only.
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

# Terminal 2
cd web
npm ci
npm run dev
```

`npm ci` verifies the lockfile's package integrity and runs `setup:models`.
That script verifies the full pose model SHA-256 and copies the official
`@mediapipe/pose` runtime/model assets into ignored `public/mediapipe/`.
No runtime CDN or external model request is needed. `npm run build` includes
these assets in `dist/`; the model files are not committed.

The default API is `http://127.0.0.1:8000`. Copy `.env.example` to `.env.local`
to change `VITE_DANCIFY_API_URL`. Restart Vite after changing it. Both Vite and
the unauthenticated API must run locally on the player computer. A cloud
development machine cannot directly access your physical webcam.

The current cloud workspace uses an isolated API on **8001**, data under
`backend/data/web-development/`, and an ignored `.env.local` pointing to it.
Existing data in `backend/data/` was preserved.

## Workflow

1. Enter a URL or upload a video containing the intended music. Optional start/end
   times select choreography without intros/end cards.
2. Create and prepare. The durable worker exposes stages and actionable failures.
   The browser remembers the last job across reloads. A download error offers
   upload fallback; a tracking error offers diagnostics and range selection.
3. Select a ready song. The loader validates its chart and report, then pins one
   immutable bundle for the whole game. A replacement does not change that session.
   Old charts without aspect-aware normalization metadata require regeneration.
4. Use keyboard practice, or select camera scoring and enable the camera. All
   camera frames remain local. The preview is mirrored; inference is unmirrored.
5. Play the reference video. Its embedded audio and `currentTime` own playback.
   No separate audio element runs. Save a completed result; failed saves are
   retained in browser storage and can be safely retried with the same session ID.

Keyboard: Space toggles playback, R replays, left/right seek, and Enter hits a
checkpoint in keyboard practice. Inputs/buttons retain normal keyboard behavior.
The on-screen hit button also supports keyboard practice. Simulated wearable
events only control playback/volume and never award points.

Seeking starts an unrecordable practice segment. Replay from the beginning to
record a complete result. Changing mode or song resets the session and stops the
camera. Backgrounding the tab pauses the reference video.

## Scoring contract and limits

- One static pose per half-open window `start <= t < end`; no invented motion,
  hold scoring, or inferred exact musical hit time.
- Compare the best valid sample in each window once. Late results from closed
  windows or previous pause/seek epochs are discarded.
- Apply Python's x/z aspect-ratio scaling and hip/torso normalization using actual
  inference-frame dimensions. Golden portrait/landscape fixtures are shared.
- Require visible shoulders/hips and at least six mutually visible gameplay joints
  at confidence >=0.35. Invalid geometry yields `null` / LOST, not zero / MISS.
- Weighted joint-angle and limb-direction similarities favor arms. Provisional
  thresholds: PERFECT >=0.94, SUPER >=0.85, GOOD >=0.70; otherwise MISS.
- Points: 1000/700/400/0. LOST awards no points and breaks combo but remains a
  distinct judgment. Accuracy includes lost checkpoints in its denominator;
  tracking coverage shows the fraction with any valid comparison. With no valid
  comparisons, accuracy is null. Keyboard results are explicitly stored as
  `keyboard_practice`, never camera results.
- Browser MediaPipe Pose 0.5.1675469404 uses complexity 1. Its full-model SHA-256
  matches Python MediaPipe 0.10.18's packaged model:
  `e9a5c5cb17f736fafd4c2ec1da3b3d331d6edbe8a0d32395855aeb2cdfd64b9f`.
  Graph/runtime/smoothing differences still require human calibration.
- Inference is capped at 15 Hz with one frozen frame in flight. Device performance,
  webcam framing/lighting, and judgment thresholds still need a real-player trial.
  Current camera integration tests use recorded dancer footage through Chromium's
  simulated webcam, not a physical human webcam session.
- URL downloads depend on provider access. Bot blocks are not bypassed. Configure
  yt-dlp authentication on the player machine as documented by the backend.

## Logic / visual-component boundary

| File | Contract exposed to visual components |
|---|---|
| `src/core/api.ts` | Songs, preparations, pinned bundles, diagnostics, history |
| `src/hooks/usePreparation.ts` | Job state, reconnection, completion notification |
| `src/hooks/useGame.ts` | Video/camera refs, session snapshot, playback/input actions |
| `src/core/session.ts` | Pure checkpoint state machine and result construction |
| `src/core/pose.ts` | Normalization and comparison; no React/DOM |
| `src/core/outbox.ts` | Exact persisted save payload and idempotent retries |
| `src/core/WearableClient.ts` | Fake event transport; future Bluetooth belongs here |
| `src/components/` | Replaceable development controls and skeleton targets |

Your designer can deliver components incrementally. Give a gameplay component
the snapshot (`score`, `combo`, `judgments`, `time`, `upcomingIds`, etc.) and the
hook's actions. Keep video refs connected and leave timers/scoring inside the
controllers. Read Figma variables/frames before implementing branded screens;
this development harness deliberately uses native browser styling.

## Validation

```bash
cd web
npm test
npm run build
```

Browser integration tests require Chromium and a seeded **isolated** backend.
They create/delete their own upload song and append clearly named test plays to
the development seed; never point them at production/personal data.

```bash
# Terminal 1, repository root (set writable caches if home is read-only).
export MPLCONFIGDIR=/tmp/dancify-cache/matplotlib
export XDG_CACHE_HOME=/tmp/dancify-cache/xdg
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"
DANCIFY_DATA_DIR="$PWD/backend/data/web-development" \
  backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001

# Terminal 2, repository root, same cache exports.
BASE_URL=http://127.0.0.1:8001 bash backend/scripts/bake_demo_songs.sh \
  --manifest backend/data/web-development/seed-manifest.json \
  --results backend/data/web-development/seed-results.json \
  --work-dir pipeline/outputs/web-seed
cd web
DANCIFY_TEST_API=http://127.0.0.1:8001 npm run test:browser
```

Tests use `/usr/bin/chromium` by default; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
for another installation. The test runner starts Vite when needed. Stop any
existing Vite instance using a different API before running the suite.

The browser suite verifies real MP4 decoding, pause/seek/replay, keyboard scoring,
an ambiguous save retry, local MediaPipe inference and camera cleanup, real upload
preparation, and the provider-failure fallback UI. Only the download failure UI
test mocks the API. Unit tests verify pose parity, invalid charts, lost tracking,
pause/seek epochs, keyboard isolation, bundle pinning, and outbox recovery.

## Temporary timing overlay

The game shows a switchable overlay on the reference video. Beat diamonds cross
NOW at the chart's `beat_times`; pose bars span the actual scoring windows. The
current/next stick-figure pose, Enter/MATCH prompt, score, and combo remain visible
on the video. Positions derive from the existing video-time snapshot, including
pause, seek, and replay. Arrow keys still seek; this does not invent directional
notes or exact hit timestamps. Use it to compare detected beats with the music.
Native video fullscreen displays only the video; keep the player inline to show
the overlay. Artwork and human timing calibration remain follow-up work.

## Planned session player identification

The current camera runtime tracks a single person; it does not recognize faces
or reliably lock identity when spectators enter. Require one player in frame
until the new [webcam/player-lock plan](../docs/plans/webcam-player-lock.md) passes
its acceptance gates.

The planned flow pairs a stand-alone player via controller button (or explicit
keyboard/on-screen confirmation), stores a face descriptor in browser memory for
that session, and combines body continuity with face matching to retain/reacquire
the player. Ambiguity pauses video and scoring; it never silently selects another
person. Face data is neither uploaded nor persisted and is cleared on session
completion/exit, re-pairing, and camera/mode changes. Models and thresholds remain
to be selected and tested. This adds no account system, scoring input from the
wearable, schema fields or changes to the solo reference-video pipeline.

## Visible webcam tracking (W1 implementation)

Camera mode now includes a selectable device, explicit enable/stop controls,
a mirrored skeleton preview, current/next target pose, and a visible-joint count.
The preview canvas draws the exact frozen frame that produced the landmarks so
video and skeleton align even when inference is slower than camera capture.
Only finite, in-frame gameplay joints above the existing visibility threshold
are drawn. The skeleton can be hidden without changing scoring.

States distinguish starting, finding a body, tracking with framing guidance,
ready visibility, lost tracking, and camera failure. Ready means all 12 gameplay
joints are visible and normalization succeeds; it does not establish identity,
pose correctness or calibrated scoring. Face matching and multi-person player
lock remain planned. Keep one player in frame.

Changing/stopping cameras pauses reference playback, invalidates old captures,
stops the previous stream, and clears the displayed camera frame. Enabling a
replacement camera is explicit. Permission, unavailable-device, busy-camera and
stalled-stream failures explain recovery; keyboard practice remains available.
Preview mirroring does not change the existing unmirrored comparison convention.

Automated validation uses recorded dancer footage through a simulated webcam.
A real-player trial on the demo machine is still required to complete W1's human
acceptance gate and measure latency, framing and left/right usability.

For webcam testing, camera mode places the reference video on the left and the
mirrored player/skeleton feed on the right on wide screens. Both players retain
their full image with letterboxing rather than cropping. On narrow screens they
stack; native video fullscreen shows only that feed, so keep playback inline to
compare both. Playback timing and scoring are unchanged.
