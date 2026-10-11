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

1. From Main menu, choose Import video. Enter a URL or upload a video containing the intended music. Optional start/end
   times select choreography without intros/end cards.
2. Create and prepare. The durable worker exposes stages and actionable failures.
   The browser remembers the last job across reloads. A download error offers
   upload fallback; a tracking error offers diagnostics and range selection.
3. Select a ready song. The loader validates its chart and report, then pins one
   immutable bundle for the whole game. A replacement does not change that session.
   Old charts without aspect-aware normalization metadata require regeneration.
4. Enable the camera and grant permission; camera tracking is required. All
   camera frames remain local. The preview is mirrored; inference is unmirrored.
5. Play the reference video. Its embedded audio and `currentTime` own playback.
   No separate audio element runs. At video end the final score is shown immediately,
   with Play again, Choose another song, and Main menu actions. There is no save
   button or player-name form. Complete rounds are recorded as anonymous in play
   history in the background. Network/storage errors never block the score or
   navigation. Failed requests remain in the existing pending outbox when local
   storage is available; the main menu exposes its diagnostic retry controls.

Keyboard arrows/Tab and Enter operate menus and native buttons only. Keyboard
practice, Enter-to-score, the hit button, and global Space/R/seek shortcuts are
removed. Simulated wearable events control menu focus/selection and playback;
they never award points. A camera is required even without a controller.

Seeking starts an unrecordable practice segment. Replay from the beginning to
record a complete result. Changing song resets the session and stops the
camera. Backgrounding the tab pauses the reference video.

## Scoring contract and limits

- One static pose per half-open window `start <= t < end`; no invented motion,
  hold scoring, or inferred exact musical hit time.
- Compare the best valid sample in each window once. Late results from closed
  windows or previous pause/seek epochs are discarded.
- Apply Python's x/z aspect-ratio scaling and hip/torso normalization using actual
  inference-frame dimensions. Golden portrait/landscape fixtures are shared.
- Require all 12 mutually visible gameplay joints for scoring
  at confidence >=0.35. Preview normalization can still use a partial body. Invalid geometry yields `null` / LOST, not zero / MISS.
- Chart loading now applies the scorer's own comparability check to every target.
  Older partial-body or collapsed targets require regeneration before play;
  the UI explains this instead of silently producing unavoidable LOST results.
- Weighted joint-angle and limb-direction similarities favor arms. Provisional
  thresholds: PERFECT >=0.94, SUPER >=0.85, GOOD >=0.70; otherwise MISS.
- Points: 1000/700/400/0. LOST awards no points and breaks combo but remains a
  distinct judgment. Accuracy includes lost checkpoints in its denominator;
  tracking coverage shows the fraction with any valid comparison. With no valid
  comparisons, accuracy is null. New results always use `camera`. Older
  `keyboard_practice` history/outbox entries remain compatible but no new practice
  sessions can be created.
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
| `src/core/WearableClient.ts` | BLE receiver, framed message parser, connection lifecycle and simulated input |
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

`.github/workflows/web.yml` runs frontend tests/build and launcher tests on
relevant pushes and pull requests, then prepares real media in a fresh temporary
database for the browser suite. CI installs Playwright's matching Chromium;
the browser job sets `PLAYWRIGHT_BROWSERS_PATH` for both installation and tests,
so the runner's temporary `XDG_CACHE_HOME` cannot redirect browser discovery.
It never depends on existing prepared songs. Python contract fixture changes
also trigger backend tests.

To exercise the same isolated browser runner locally, with installed Python/web
dependencies and Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium bash web/scripts/test-integration.sh
```

To reproduce CI's downloaded-browser path instead of using system Chromium:

```bash
# Repository root; use the same absolute directory for installation and execution.
export PLAYWRIGHT_BROWSERS_PATH=/tmp/dancify-playwright-browsers
(cd web && ./node_modules/.bin/playwright install --with-deps chromium)
env -u PLAYWRIGHT_CHROMIUM_EXECUTABLE bash web/scripts/test-integration.sh
```

After isolating caches, the runner first launches Chromium and renders a small
page using the integration suite's browser options. Missing browsers or launch
dependencies fail before API startup or media preparation. No fallback browser
is silently selected. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` remains an explicit local
override.

Run from the repository root. Optional `DANCIFY_TEST_API_PORT` and
`DANCIFY_TEST_WEB_PORT` select unused ports (defaults 8765 and 5173). Occupied
ports fail before startup. The helper stops only its own API; Playwright owns
Vite. Test failures propagate as nonzero exit codes and retain diagnostics.
GitHub execution still needs a pushed branch; local runs do not establish a
green GitHub check or configure branch-protection requirements.

The browser suite verifies real MP4 decoding, pause/replay, camera-only scoring boundaries,
immediate end scores despite history failures, end-screen navigation, local
MediaPipe inference and camera cleanup, real upload
preparation, and the provider-failure fallback UI. History-failure and download-failure checks intercept API requests. Unit tests verify pose parity, invalid charts, lost tracking,
pause/seek epochs, absence of keyboard scoring, bundle pinning, and outbox recovery.

## Video presentation

The reference dancer's video has no Dancify beat/pose timing overlay or target
figure layered over it. The start/replay countdown remains. Graphics already
embedded in an uploaded video are part of that source video.

The user's mirrored webcam retains its tracked-body skeleton. Illustrated target
poses remain beside the webcam and in Developer tools' upcoming checkpoints.
Removing the reference overlay does not change beat extraction, tracking, scoring,
or the reference video's role as the gameplay clock.

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
completion/exit, re-pairing, and camera changes. Models and thresholds remain
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
stalled-stream failures explain recovery; retry the camera or return to the menu.
Preview mirroring does not change the existing unmirrored comparison convention.

An independent watchdog stops the camera and pauses the round when a warmed-up
inference or frame stream stalls for 2.5 seconds. Startup has a separate bounded
model-loading/warmup allowance. Late results are discarded, including results
arriving before a delayed timeout callback. Recovery requires enabling the camera
and confirming readiness again. A browser timer cannot interrupt synchronous WASM
that blocks the JavaScript thread; the deadline is checked again when control returns.

Automated validation uses recorded dancer footage through a simulated webcam.
A real-player trial on the demo machine is still required to complete W1's human
acceptance gate and measure latency, framing and left/right usability.

For webcam testing, camera mode places the reference video on the left and the
mirrored player/skeleton feed on the right on wide screens. Both players retain
their full image with letterboxing rather than cropping. On narrow screens they
stack; native video fullscreen shows only that feed, so keep playback inline to
compare both. Playback timing and scoring are unchanged.

### Replay and movement diagnostics

Use **Replay round** during play (with confirmation) or **Play again** on the
results screen to start a new session, clearing scores and movement logs. Each replay
shows a 3–2–1 countdown with video and scoring paused, then starts at the beginning.
Cancel countdown leaves playback paused. Changing song, stopping
or switching the camera, or hiding the tab cancels the pending start. Camera
samples captured before the countdown finishes cannot score the new round.
Download a log before replaying if you want to keep it. Seeking, changing the
song, and closing the page also discard the current log.

In camera mode, **Movement diagnostics** records up to 6,000 samples in browser
memory (oldest samples are dropped when full). Disable recording or clear the log
at any time. **Download movement log** explicitly exports JSON containing the
bundle/session IDs, body-only target and player coordinates, visibility,
inference duration, scoring decisions, component similarities, and each
checkpoint's winning sample timestamp. It contains no camera frames, face
landmarks, face descriptors, or player names, and is not uploaded to the API.
Dropped/cleared samples may mean a winning sample is no longer in the log.
Stale samples from a previous epoch are excluded; recording stops at round end.

Scoring version `checkpoint-v2-full-body-provisional` requires all 12 gameplay
joints (shoulders, elbows, wrists, hips, knees, ankles) to meet the existing
visibility threshold in both reference and player poses. Previously, omitted
limbs could leave only matching components and inflate a partial-body comparison
to PERFECT. Incomplete comparisons and collapsed or nonfinite limb geometry
now return insufficient data, giving LOST when no complete comparison occurs
in the checkpoint. Keep the whole body in view;
reference checkpoints with obscured joints may also produce LOST.

This remains static checkpoint scoring with provisional thresholds. Standing
still can legitimately match a stationary target; no arbitrary movement penalty
is applied. A whole-round perfect score against changing poses needs a log to
identify whether the chart, tracking, or comparison is responsible. Movement delta
is mean normalized joint displacement, not a calibrated activity or accuracy metric.


### Before hardware/design: readiness and controller input

For the controller-free demo, camera mode automatically starts the 3–2–1
countdown once the whole body has been tracked for one second. Enable the camera
and grant browser permission first. Tracking must remain ready during countdown;
lost framing cancels it and stable framing restarts it from three. Play again
also waits for readiness before counting down. Manual pause/cancel, camera failure,
backgrounding and controller disconnection disable automatic starting until an
explicit Ready/resume or replay action. Results never automatically replay.
If the browser blocks playback, use the on-screen Ready button to retry.
This is framing readiness only: stand alone. The current model cannot count
people, bind the wearer to a body, or recognize a face. More than 0.75 seconds of
incomplete framing while playing pauses the round; regain framing and explicitly
confirm Ready to resume. Camera failure/device change and backgrounding cancel
pending starts. Readiness tolerates observation gaps up to the existing 2.5-second
camera stall limit; it is not a calibrated motion or identity test.

**Controller connection and testing** offers Connect ESP32 and a simulator.
Windows Chrome/Edge connects through the Windows Bluetooth adapter directly;
WSL still hosts the web/API processes. Use localhost or HTTPS. Unsupported
browsers keep on-screen controls and simulation available. The user must initiate the
Bluetooth picker; no automatic reconnect or hardware availability is assumed.

The receiver uses the UUIDs in `../schema/wearable.protocol.md`, also recorded
in the PRD. It subscribes to TX notifications and accepts the frozen UTF-8,
newline-terminated messages, including split/coalesced lines. DIR:DOWN/RIGHT
advances menu focus, DIR:UP/LEFT moves backwards, and BTN:CLICK activates the
focused item. Button edges, HOLD and JOY do not select or score. The agreed
rotary firmware mapping is clockwise → DIR:DOWN, counterclockwise → DIR:UP.
The 2026-10-11 feedback revision adds RUN and defines beat phase; use updated firmware.

Up/Down arrows use the same ordered menu navigation. Text inputs/selects retain
native behavior. Simulated Previous/Next/Select exercise it without an ESP32.
Connection persists across songs; losing it pauses play/countdowns and requires
reconnection or the explicit **Continue without controller** action. Reconnection
never automatically resumes a round or identifies the wearer.

Physical BLE acceptance is pending: advertise the frozen service and device-name
prefix Dancify-Wearable, test rotation/button edges, then disconnection/reconnection
on the actual Windows demo machine. Unit/browser doubles validate software paths,
not radio reliability. Browser RX beat/hit output is implemented; firmware and
audible timing validation remain pending. Multi-person tracking, face-model selection/enrollment, session identity,
Figma integration, and real scoring calibration remain separate acceptance gates.

Use [the teammate test checklist](TEAMMATE_TEST.md) for physical Windows trials.
[The identity implementation proposal](IDENTITY_IMPLEMENTATION.md) records the
candidate runtime dependencies and remaining integration gates. Its tested
`PlayerLock` state machine is not yet connected to the live camera; continue
testing with one person in frame.


### Wearable output testing (no hardware needed)

The demo defaults to quiet wearable output: no metronome or per-hit beeps.
One short TONE is requested at results for a completed, unseeked round earning
at least one star (accuracy thresholds 20/35/50/65/85%). No comparable poses has
no rating/cue. Results show the earned `N / 5 stars` beside the score; a practice
segment or insufficient tracking shows an explanation instead. A hidden tab or
disconnected device receives no delayed result cue on return/reconnect. Menu
selection still requests the existing short TONE.

The supplied Scroll 3, ButtonClick and Miss1 assets play through the computer's
speakers for menu movement, activation and new MISS judgments during active play.
Audio unlocks on a real pointer/key gesture. LOST tracking is silent; old or
end-of-round judgments never cause a burst of miss sounds. Reference-video audio
remains the music source and its currentTime remains the gameplay clock.
See [asset status](src/assets/audio/README.md) for the four pending audio-only uploads.

Open **Developer tools → Controller connection and testing**, click **Connect simulated ESP32**, then
expand **Wearable command monitor**. Select a prepared song and enable the camera. The simulator shows the same command queue used by
Bluetooth; it neither plays sound nor provides score/pose data.

For the optional metronome diagnostic, set `VITE_DANCIFY_WEARABLE_METRONOME=true`
before starting Vite. Leave it unset for the quiet demo. With that diagnostic enabled:

- Playing at normal speed configures RUN:0 → BPM → BEAT → RUN:1. BEAT and periodic
  SYNC use seconds until the next actual chart beat from reference video time.
- Finalized GOOD/SUPER/PERFECT checkpoints send HIT:1 once.
  MISS/LOST do not trigger hits. Feedback stops after the last
  chart beat, at results, during countdown, on pause/buffering/tracking loss,
  hidden tab, and song change. Non-unit playback speed disables feedback.
- Replay waits for the countdown before reconfiguring; reconnect stays paused.
  Disconnect the simulator during play to exercise the Continue without controller action.
- The monitor retains 200 successful writes in browser memory only. Clear commands
  to isolate a test; clearing the monitor does not reset gameplay or deduplication.
- Menu selection requests TONE:880; turning the control is silent. Obsolete queued
  tones may be cancelled by a playback lifecycle change.

Real devices must support RX writes with response and the revised protocol's RUN
commands, disconnect silence and 15-second SYNC fail-safe. The browser sends an
initial stop, bounds pending writes to 32, times out a write after two seconds,
and pauses/disconnects on failure. An in-flight write cannot be recalled. Old
firmware without RUN is incompatible even if Bluetooth connection succeeds.

HIT occurs at judgment finalization, not an explicit choreography hit timestamp.
No audible latency/drift guarantee has been verified; see the
[wearable handoff](../docs/handoffs/wearable-output-rfc.md) for physical acceptance.

Regression commands: `npm test`, `npm run build`, then from the repository root
run `python3 -m unittest discover -s scripts/tests -v` and the documented
`web/scripts/test-integration.sh` with a shared installed Playwright browser path.

### Illustrated target poses

Prepared songs show **Lenny** or **Human** in the camera target and
upcoming checkpoint list. Use **Target character** to switch without restarting. **Show target skeleton instead of artwork** switches all targets
for comparison without restarting the video/session. Artwork loading/failure and
unusable projected geometry retain the skeleton display; scores use the original
chart landmarks in either presentation.

The diagnostic page at `/debug/pictograms.html` on the Vite development server
shows five explicitly labeled test poses. Load a prepared `dance.json` there to
compare every real checkpoint against its skeleton. This page does not play or
score a round and is not included in the production build.

Source art, rig and alternatives for Human and Lenny are preserved under
`assets/pictograms/`. Both characters use front/open-hand sprites in gameplay.
Lenny has green skin, cream scutes/horns and dark green outlines from the supplied
reference. Human has blue fills and dark navy outlines. The colors are baked into
the checked-in runtime PNGs; palette definitions live in `src/pictograms/palette.json`.
The original author used viewer-relative side labels; the adapter explicitly
maps those to MediaPipe's anatomical indices without mirroring chart coordinates.
The artwork has no inferred finger gestures, facial expressions or profile changes.

Small runtime PNGs are checked in, so normal setup needs no extra generation step.
After approved source-art changes, regenerate from the repository root with:

```sh
node web/scripts/bake-pictogram-colors.mjs
npm test --prefix web
npm run build --prefix web
node --test assets/pictograms/rig.test.mjs
```

The bake command first runs the crop generator with Pillow already installed in
the pipeline, then uses the installed Chromium to render the palette fills. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is not at `/usr/bin/chromium`. It
crops each side inside the authored clip region and resizes to at most 256 pixels. It leaves
source images/pivots unchanged and records source hashes/crop coordinates.
See [the pictogram handoff](../docs/handoffs/pictogram-integration.md) for scope,
review steps and remaining designer decisions. The Figma screen redesign is
separate from this renderer integration.

## First-draft visual pages

See [design.md](../design.md) and [the implementation handoff](../docs/handoffs/game-pages.md).
Main menu leads to song selection or import. The palette, large centered menu
buttons, and bundled Bungee Inline/Jersey 25 fonts are shared through
`src/styles.css`. Gameplay remains camera-only. Active-round exit/restart actions
use confirmation dialogs; cancelling leaves playback paused until Ready/countdown.
The side-by-side feeds and expandable movement/controller diagnostics remain.

The latest Figma canvas was unavailable during implementation. Button sizing is
provisional; final star exports and designer comparison remain. No fabricated
star rating or progress percentage is displayed.


## Approved setup and developer screens

- Import: **Advanced · title and clip range** holds optional naming and range
  controls. Without a title, the filename or URL hostname provides a name.
- During a round, **Settings** contains camera selection/refresh/stop, body
  skeleton, music volume, target character and wearable connection.
- **Developer tools** holds movement logs, controller connection/simulation,
  command monitoring and chart diagnostics (including timing-overlay toggles).
- Opening either game tools screen pauses the video and cancels the countdown.
  Back or Escape restores focus to its launcher; press Ready to resume.
  The media elements, game session and score are preserved.
- Main menu dark/light selection persists locally. It does not affect scoring.

See [design integration status](DESIGN_INTEGRATION.md) for approved references,
remaining screen work and the agreed star thresholds.


## Sliding pictograph demo (2026-10-11)

The approved demo layout places up to four current/upcoming Lenny or Human targets
over the bottom-right of the reference video with a six-second preview. Position
comes only from the existing video-time snapshot. A target reaches NOW at its
checkpoint start and stays there until its window closes; this is a visual cue,
not an exact-hit or hold-scoring change. Pause/countdown/buffering freeze the
strip; replay/seek reset it. Reduced motion shows a stationary current/next row.
The artist rig and rink tokens are reused; overlay dimensions are provisional
demo styling approved in chat, not measured from a new Figma frame. The duplicate
static camera target is removed. Manual Start and upper-body demo scoring remain.

## Temporary promotional results override (2026-10-11)

User-requested promo capture mode is enabled by `PROMO_FIVE_STAR_RESULTS` in
`src/components/GamePanel.tsx`. Every completed round displays five stars and
uses the existing milestone-then-win result audio, including rounds with zero
accuracy, no tracking, or a practice seek. Unfinished rounds still have no rating.
Raw points, accuracy, tracking, judgments and persisted results remain measured;
the override only controls the result stars and celebration. Set the constant
to `false` after recording to restore the usual rating eligibility and thresholds.
