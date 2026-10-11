# PRD — Dancify (Wearable Rhythm Game)

**Version:** 1.3 (working branch)
**Last updated:** 2026-10-11
**Owner:** [Your name]
**Status:** Active development — 48-hour hackathon build

**Current interaction decision (2026-10-11):** the user removed keyboard gameplay.
Every new round requires webcam tracking. Remove keyboard practice, key/button
hits, and global gameplay shortcuts. Native keyboard menu/button accessibility
remains. The wearable is optional; continuing without it still requires a camera.
Camera failure offers retry or menu exit. This decision supersedes references to
keyboard-only gameplay/fallback in the original roadmap below; those passages
remain historical planning context. Existing practice history stays readable.
See [the game pages handoff](docs/handoffs/game-pages.md).

This document describes the product vision and target architecture. The shipped
prep implementation is a narrower hackathon MVP: short, stable, solo-dancer CFR
clips only. Reference-video multi-person identity isolation, angular-velocity
energy, and hold merging remain deferred. Live webcam session player identification
is now planned separately in §4.2.1; it is not implemented. See `pipeline/README.md` and
`pipeline/CALIBRATION.md` for the implemented contract.

---

## 1. One-Line Summary

A Just Dance clone that works on any dance video: paste a TikTok or YouTube link, wait two minutes while a prep pipeline extracts the beat and hit moments, then play a rhythm game where the webcam tracks your body and a custom ESP32 wearable clicks the beat on your wrist and controls the game.

---

## 2. Pitch (For Demo)

> We built a Just Dance that works on any video. Paste a TikTok or YouTube link, wait two minutes while our pipeline finds the beat and the choreography's hit moments, and then play it. The webcam tracks your body — no controller, no mocap suit, no training data. And on your wrist is a custom wearable that feels the beat: it clicks on every beat so you don't need to hear the laptop, and it triple-taps when a pose scores. You can pause, change tracks, and adjust volume from your wrist without ever touching the laptop. The pictograms are hand-drawn by a real artist and turned into a paper-doll rig — infinite poses from fifteen drawings. This is a rhythm coach you wear.

---

## 3. Build Order — Vision First, Hardware Later

**This is a deliberate reordering.** The vision pipeline (MediaPipe + joint smoothing + primary subject isolation) is the highest-risk unknown and must be validated before anything else is built. The hardware (ESP32 + rotary angle sensor + single button + piezos) is a known quantity and can be built later without risk.

**Rules:**
- Hardware firmware is built in **Phase 3**, not Phase 1.
- The BLE contract (`wearable.protocol.md`) is still frozen in **Phase 0**.
- The game's `WearableClient.ts` module is built in **Phase 1** against a **fake event source**. Swapping to real BLE in Phase 3 must not require changes to the game loop.
- The game must remain fully playable with keyboard only at every phase. This is the demo-day fallback if hardware fails.

---

## 4. Product Architecture

Three independent pieces plus one shared contract layer.

### 4.1 The Prep Pipeline (Python, offline, runs once per video)

**Target input:** a video file from a local path or supported URL.
**Shipped MVP input:** a short, stable, front-facing solo-dancer CFR clip.
**Output:** a `dance.json` file plus cached audio and any pictogram assets.

**Target stages** (deferred items are marked):
1. Download or ingest video (local file or URL via `yt-dlp`).
2. Extract audio with `ffmpeg`.
3. Run `librosa.beat.beat_track()` for BPM and beat times.
4. Sample video at 30fps, run MediaPipe Pose on each frame → 33 landmarks per frame.
5. **Deferred — primary subject isolation:** for multi-person frames, keep only the highest-confidence / largest bounding box and track the same person.
6. **Joint smoothing:** the MVP uses Savitzky-Golay smoothing; per-resolution tuning remains target work.
7. Compute per-frame **motion energy**. The MVP uses confidence-masked normalized landmark speed; weighted joint angular velocity remains deferred.
8. Find **dips** in the motion-energy curve — these are held poses, the hit moments.
9. Snap each dip to the nearest beat or half-beat.
10. **Deferred — hold merging:** merge consecutive hits with similar target poses (a 4-beat hold = 1 hit with a hold bar, not 4 hits).
11. Write `dance.json`.

**Required tooling:** a velocity-curve debug view showing the motion-energy curve, beat grid, and detected hit markers. If markers don't sit in the dips and on the grid, the pipeline is wrong. This is not optional — it's the only way to diagnose the pipeline.

**Required tooling:** a raw-vs-smoothed overlay view to verify joint smoothing quality.

### 4.2 The Game (TypeScript / React, runs live in the browser)

**Stack:** TypeScript, React, Canvas 2D, `@mediapipe/tasks-vision`, Web Bluetooth API.

**Runtime flow:**
1. Load the reference video, `dance.json`, and aligned audio sidecar bundle.
2. Turn on webcam and run local pose inference. Planned: explicitly pair the player and maintain their session identity as described in §4.2.1 before accepting camera scoring samples.
3. **Master clock = the reference `<video>` element's `currentTime`** (not `performance.now()`, not `AudioContext`, and not a separate audio element).
4. On each frame:
   - Read `t = referenceVideo.currentTime`.
   - Find the active move (hit moment whose window contains `t`).
   - Interpolate the target pose.
   - Compare the player's pose to the target.
   - Update score, combo, judgment.
   - Fire a piezo triple-click over BLE on a scored hit (Phase 3+).
5. Render the player's skeleton, pictogram queue, beat-pulsing UI, judgment popups.
6. End screen: star rating, accuracy, longest combo.

**Pose comparison rules:**
- Normalize around hip center and torso scale.
- Use visible shoulder / elbow / wrist / hip / knee / ankle joints.
- Visibility threshold: 0.35.
- Minimum matched joints: 6.
- If torso or too few joints are visible, **return `null`, not 0**. The game loop distinguishes miss vs. lost-tracking.
- Comparison metric: cosine similarity of joint-angle vectors, weighted toward arms and legs.

**The game must remain fully playable with keyboard only.** In menus, arrow keys move focus through items and Enter activates the focused item, matching rotary navigation and the single button. Gameplay keyboard bindings remain context-specific. This is the demo-day fallback if Bluetooth fails.

### 4.2.1 Session player identification (planned)

Pair the player standing alone in the camera guide with the connected controller
using a button confirmation, with an explicit keyboard/on-screen fallback. Keep
a temporary face descriptor in browser memory associated with that body track.
Use multi-person body tracking and face-to-body association to maintain the
selected player when spectators enter; face matching supports confirmation and
reacquisition rather than being required on every frame.

If identity is ambiguous, reject samples and pause reference playback/scoring.
Never silently switch to another person. Confident reacquisition requires player
confirmation; explicit re-pairing starts a new run. The controller identifies a
device, not its wearer, and pairing never awards points.

Face images/descriptors are session-only: no network transmission, persistent
storage, logs, saved-result fields or cross-session identity. Clear references at
session end/exit, re-pairing and camera/mode changes. This is not account login
or authentication. All models run locally in the browser.

The current single-person tracker does not implement this behavior. Multi-person
tracking, face matching, model selection and real-player validation are required.
The reference-video preparation pipeline remains solo-dancer only; chart schemas
and BLE messages remain frozen. See the [webcam implementation plan](docs/plans/webcam-player-lock.md)
for lifecycle rules, phases W1–W6, acceptance gates and unresolved model choices.

### 4.3 The Wearable (ESP32 firmware) — Built in Phase 3

**Hardware:**
- ESP32 dev board.
- Rotary angle sensor for rotational menu navigation; replaces the joystick. Exact sensor model, electrical interface, travel range, and wiring remain to be confirmed. If the chosen sensor has an analog output, use an ADC1-capable pin; do not assume a two-axis joystick pinout.
- One physical button for selecting/confirming the focused item and explicit player pairing.
- No wearable-controlled mouse pointer or two-axis cursor navigation.
- Two passive piezo buzzers wired **in parallel** to a single GPIO through a shared 100Ω resistor.
- Velcro strap or sweatband for forearm mounting.

**Firmware behavior:**
- Sample the rotary angle sensor on a scheduled task without blocking BLE; choose cadence and filtering for the actual sensor.
- Convert signed angle changes into discrete navigation steps: clockwise advances/scrolls forward, counterclockwise moves/scrolls backward. Accumulate small changes until a step threshold is reached; suppress jitter so a stationary control emits no steps.
- For continuous-angle sensors, handle wraparound without a large false jump. For limited-travel sensors, define endpoint behavior after hardware selection; do not assume endless rotation.
- Debounce the single button. Rotation moves menu focus or scrolls the focused list; button press selects/confirms. Keep the focused item visible. There is no cursor to steer.
- Two BLE characteristics:
  - **RX** (browser → ESP32, write): `RUN:0`, `BPM:120`, `BEAT:0.5`, `RUN:1`, `HIT:1`, `TONE:880`, `SYNC:0.512`.
  - **TX** (ESP32 → browser, notify): rotary navigation steps and single-button actions. Clockwise sends `DIR:DOWN`; counterclockwise sends `DIR:UP`; see §5.2. Existing `BTN:DOWN|UP|CLICK|HOLD` messages remain the button contract.
- **Piezo driven via the LEDC peripheral, not `tone()`.** LEDC generates the waveform; firmware still schedules envelopes. BLE latency and envelope timing require physical measurement.
- **Piezo timing:** browser configures BPM/BEAT and explicitly enables RUN on each playback start/resume. ESP32 schedules envelopes without blocking and uses LEDC for the waveform. SYNC every ~5 reference-video seconds slews phase; pause/end request RUN:0. See §5.2 for fail-safes and timing limitations.

**The wearable does not contribute to scoring.** It is a coach (metronome) and a controller (menu navigation). This is a deliberate design choice.

### 4.4 The Pictogram System (Paper-Doll Rig)

**Artist delivers:** ~15 SVG parts on transparent canvases, each drawn from a canonical pivot point (shoulder, hip, knee) going straight down, exactly 100 units long.

- Head × 3 (front, 3/4, side)
- Torso × 1
- Upper arm × 1
- Forearm × 1
- Hand × 3 (open, fist, point)
- Thigh × 1
- Shin × 1
- Foot × 1

**Renderer:** for any MediaPipe pose, place each SVG at the proximal joint, rotate to point at the distal joint, scale to the distance between them, draw in layer order (back arm, back leg, torso, head, front leg, front arm). Use the z-coordinate to determine which limb is in front.

**Result:** infinite poses from 15 drawings, in the artist's style.

**Insurance:** the artist also delivers 4–6 fully-posed hero pictograms for the demo song. If the paper-doll renderer fails, swap in the hero pictograms and the demo still looks good.

---

## 5. Shared Contracts (FROZEN — Do Not Change Without Announcement)

### 5.1 `schema/dance.schema.json.json`

```json
{
  "version": "1.0",
  "bpm": 120,
  "beat_times": [0.5, 1.0, 1.5],
  "duration": 30.0,
  "moves": [
    {
      "id": "m0",
      "start": 1.0,
      "end": 2.0,
      "keyframe_landmarks": [[0.0, 0.0, 0.0, 1.0]],
      "is_hold": false
    }
  ]
}
```

The landmark array above is abbreviated for readability; the frozen schema
requires exactly 33 `[x, y, z, visibility]` tuples. Landmarks are normalized to
hip-center origin and torso-length scale.

### 5.2 `wearable.protocol.md`

**Service UUID:** `7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c`
**RX Characteristic UUID:** `7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c` (browser writes)
**TX Characteristic UUID:** `7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c` (ESP32 notifies)
**Advertised device name prefix:** `Dancify-Wearable`

**Frozen feedback revision (2026-10-11):**
- Browser → ESP32: `RUN:0|1`, `BPM:<int>`, `BEAT:<float>`, `SYNC:<float>`, `HIT:1`, `TONE:<int>`.
- Clockwise → `DIR:DOWN` (next), counterclockwise → `DIR:UP` (previous), `BTN:CLICK` selects. Legacy JOY/edges/HOLD do not select or score.
- All messages are UTF-8 and newline-terminated. RX requires writes with response.

**Current integration status:** browser input, ordered output and a bounded
simulator command monitor are implemented. During normal reference playback,
configure `RUN:0 → BPM → BEAT → RUN:1`; BEAT/SYNC mean seconds until the next
actual chart beat, sampled from video.currentTime at dispatch. SYNC is sent about
every five video seconds. Pause, buffering, tracking loss, countdown, hidden tab,
results and song/mode changes silence metronome feedback; non-unit speed disables
it. Queued stale output is discarded. A submitted BLE write cannot be recalled.

HIT follows a newly finalized GOOD/SUPER/PERFECT checkpoint while feedback is
enabled; MISS/LOST and old results never produce catch-up hits. Keyboard practice
remains labeled separately. There is no exact choreographic hit timestamp in the
chart. Menu selection requests a short TONE; rotation is silent. The wearable
never supplies scoring input or identifies its wearer.

Write failure or controller loss pauses gameplay and requires explicit reconnect
or keyboard fallback. Reconnect never resumes automatically. Firmware must boot
stopped, stop on disconnect, and stop after 15 seconds without SYNC while running.
ESP32 firmware is still absent: radio reliability, audible phase, latency and
drift require physical trials. Integer BPM and one-way phase delivery are
approximations, not a demonstrated timing guarantee.

The authorized BLE revision is now re-frozen in the authoritative
[protocol](schema/wearable.protocol.md). Dance JSON and its TypeScript mirror
remain unchanged and frozen. See the [implementation handoff](docs/handoffs/wearable-output-rfc.md).

---

## 6. Repo Layout

```
/
  schema/
    dance.schema.json.json  ← FROZEN (legacy double extension)
    type.ts                 ← FROZEN
    wearable.protocol.md    ← FROZEN
  pipeline/                 ← Person A only
  backend/                  ← Person A (song/chart cache API; web consumes it)
  web/                      ← Person B only
  firmware/                 ← Person C only
  assets/pictograms/        ← Artist only
  docs/handoffs/            ← Integrator only
```

**Ownership rules:**
- Directory ownership is absolute.
- Shared files (`package.json`, `index.html`, `.gitignore`) are integrator-only.
- Never commit video or audio files into git. Store uploaded media under `backend/data/` (gitignored) or a shared Drive folder referenced in `.env`.
- Branches live <4 hours. Rebase before every PR. Small PRs, merged often.

---

## 7. Tech Stack

**Prep pipeline:**
- Python 3.10+
- `librosa`, `mediapipe`, `opencv-python`, `ffmpeg` (system), `yt-dlp`

**Game:**
- TypeScript, React, Vite
- `@mediapipe/tasks-vision`
- Canvas 2D (no WebGL — not needed)
- Web Audio API (playback only, not master clock)
- Web Bluetooth API (Chrome/Edge only)

**Firmware:**
- Arduino C++ (ESP32 board package)
- `BLEDevice`, `LEDC` peripheral

**Song cache API (`/backend`) — weekend override:**
- **Why:** We need somewhere to hold user clips/dances, cache pipeline `dance.json` (+ audio) so we do not re-run MediaPipe/librosa on every play, and store per-song play history. Without this, every retry burns compute and demo prep is fragile.
- **What:** Local **FastAPI** app + **SQLite** (`backend/data/dancify.db`) + files on disk under `backend/data/songs/<id>/`. **No auth**, no user accounts, no cloud DB, no cloud GPU.
- **Run:** `cd backend && uvicorn app.main:app --reload --port 8000` (see `backend/README.md`).
- The game remains a static Vite app; host the frontend on Vercel or GitHub Pages if desired. The API is a local/dev companion for the hackathon, not a production multi-tenant service.

---

## 8. What Does NOT Need to Happen

State explicitly so no one wastes time:

- **No model training.** MediaPipe is pretrained. `librosa` is classic DSP. Motion energy is arithmetic. Pose comparison is trigonometry.
- **No cloud backend / no auth product.** Do not build user accounts, OAuth, cloud GPU inference, or paid API-key services. The **local** FastAPI + SQLite song cache in `/backend` is allowed and expected — it only stores songs, cached charts, and play history.
- **No IMU.** The wearable doesn't score.
- **No motion capture suit, no depth camera, no cloud inference.**
- **No glowing hand overlay on the reference video.** The shipped MVP requires
  one continuously visible dancer; target multi-person isolation remains
  deferred.

---

## 9. Optional: Shot-Review + Confirmation

If time allows, add a review step between download and analysis:

- Advisory cut markers on the video timeline.
- User selects a continuous range.
- UI requires an explicit checkbox: "This range is one front-facing dancer in a single uninterrupted take."
- The song-cache API (or pipeline CLI) rejects analysis without `single_front_facing_take: true`.

This de-risks the pipeline by making the user responsible for choosing a clean input. **Build only if Phase 1 gates pass with time to spare.**

---

## 10. 48-Hour Roadmap (Vision-First Ordering)

The following is the original hackathon schedule. The newly approved live webcam
player-lock work follows phases W1–W6 in the [webcam plan](docs/plans/webcam-player-lock.md);
it is not a completed gate or a change to the solo reference-video MVP.

| Phase | Hours | Goal | Gate |
|---|---|---|---|
| 0 | 0–2 | Foundation | Contracts frozen, everyone committed |
| 1 | 2–14 | Vision pipeline + game skeleton | Pipeline correct on 3 videos, MediaPipe works on real webcam, subject isolation tracks correctly, joint smoothing validated |
| 2 | 14–20 | Vision end-to-end | One real video → play → score, no fake data |
| 3 | 20–30 | Hardware bring-up + integration | BLE works, piezo on beat, rotary control scrolls menus and button selects |
| 4 | 30–40 | Features + juice | Three consistent playthroughs, no crashes |
| 5 | 40–46 | Feature freeze + demo prep | Rehearsed, backed-up demo on demo machine |
| 6 | 46–48 | Demo | Demo happens |

**Feature freeze at H40. No exceptions.**

---

## 11. Phase Details

### Phase 0 — Foundation (H0–2)

- Freeze `schema/dance.schema.json.json`, `schema/type.ts`, and `schema/wearable.protocol.md`.
- Scaffold repo directories.
- Commit `PRD.md.md`.
- Everyone pushes one trivial commit to their branch.
- **Gate:** contracts frozen, everyone committed.

### Phase 1 — Vision Pipeline + Game Skeleton (H2–14)

**This is the whole team's focus.** Everyone who can help with vision, does.

**Person A — Prep pipeline:**
- `video → ffmpeg → librosa beats → MediaPipe poses → smoothing → motion energy → hit moments → dance.json`.
- Joint smoothing: Savitzky-Golay, tune per resolution.
- Target/deferred: primary subject isolation across multi-person video.
- MVP boundary: reject unstable tracking and accept stable solo CFR clips only.
- Velocity-curve debug view (non-negotiable).
- Raw-vs-smoothed overlay view.
- Run the MVP on solo/portrait clips; retain multi-person validation as a future gate.

**Person B — Game frontend:**
- React scaffold, fake `dance.json`, MediaPipe PoseLandmarker on webcam, skeleton render.
- Master clock = the reference `<video>` element's `currentTime`.
- Pictogram queue with hardcoded pictograms.
- Pose comparison returning `null` for insufficient data.
- Build `WearableClient.ts` against a **fake event source**. Interface defined, transport stubbed.

**Person C — Vision test harness + MediaPipe edge cases:**
- Standalone MediaPipe test page (no game logic): loads a video, runs pose extraction, renders landmarks + bounding boxes + smoothed vs. raw overlay. This is the debugging tool for A and B.
- Test MediaPipe on: fast motion, dim lighting, 2+ people in frame, portrait aspect ratio, low resolution.
- Document every failure mode and its symptom. Hand to A.

**Person D — Artist:**
- 15 SVG parts (canonical pivot, 100-unit length).
- 4–6 hero pictograms for the demo song.

**Target gates** (not all are claimed by the shipped solo/CFR MVP):
1. A's pipeline produces a correct `dance.json` for 3 videos, verified in the debug view.
2. Joint smoothing visibly reduces jitter without lagging fast motion (raw vs. smoothed side-by-side).
3. Deferred: primary subject isolation tracks the correct person across the full duration of a multi-person clip.
4. B's game runs on a real webcam with MediaPipe WASM in Chrome. No crash. Skeleton renders.
5. C's test harness documents at least 5 known MediaPipe failure modes with symptoms.

**Sleep block at end of Phase 1.**

### Phase 2 — Vision End-to-End (H14–20)

- A hands B a real `dance.json`. B's game plays it.
- Play with webcam. Score updates. Lost-tracking state shows.
- Play with keyboard. Keyboard hit score works.
- Add shot-review + confirmation step if A has time.
- Tune pose comparison thresholds against real footage.

**Gate:** a single end-to-end session — import → pipeline → play → score — completes on one real video without intervention, on a real webcam, with a real MediaPipe pipeline behind it. **Not fake data.**

**This is the milestone the previous agent's prototype never hit. It is now the center of the project.**

### Phase 3 — Hardware Bring-Up (H20–30)

**Now the hardware gets built.** Person C leads, Person B supports on integration.

**Person C — Wearable:**
- Confirm the rotary angle sensor model/interface and wire it to compatible ESP32 pins (ADC1 if analog). Wire two piezos in parallel on one GPIO through a shared 100Ω resistor and the single button on a digital pin with `INPUT_PULLUP`.
- Implement the agreed rotary-to-BLE mapping in §5.2 before integration. Flash firmware with nonblocking sensor sampling, filtered angle-to-step conversion, debounced button events, and the revised `RUN`/`BPM`/`BEAT`/`HIT`/`SYNC`/`TONE` RX commands.
- Piezo on **LEDC peripheral**, not `tone()`.
- Confirm timing: hardcoded 120 BPM for 60 seconds, measure drift. Target < 20ms over 60 seconds.
- Confirm the stationary rotary control produces zero phantom navigation steps for 60 seconds. Test slow/fast rotation, reversals, and wraparound or endpoints as applicable.

**Person B — Integration:**
- Swap `WearableClient.ts` from fake source to real BLE. Event stream shape unchanged.
- Map rotary steps into ordered menu focus/list scrolling (clockwise forward, counterclockwise backward), with no mouse cursor. Keep selection visible; the single button confirms selection or player pairing according to the current screen.
- Wire `HIT:1` to fire on scored hits.
- Wire `SYNC` every 5s.
- Keyboard fallback still works when ESP32 is unplugged.

**Person A — Polish pipeline on more videos:**
- Run pipeline on 3–5 more videos. Fix edge cases.
- Hold-merge logic for sustained poses.
- Half-beat snapping.

**Person D — Additional pictograms / style pass.**

**Gates:**
1. Wearable connects over BLE to the game in Chrome.
2. Rotary motion navigates/scrolls menus in both directions; the single button selects and confirms pairing. No phantom steps over 60 stationary seconds; reversals and wraparound/endpoints behave correctly.
3. Piezo fires on the beat with < 20ms drift over 60 seconds.
4. `HIT:1` fires a triple-click on scored hits.
5. Keyboard fallback works with the ESP32 unplugged.

### Phase 4 — Features + Juice (H30–40)

- Judgment popups (PERFECT / SUPER / GOOD / MISS), combo counter, end screen.
- Pictogram queue polish, timing rings.
- Paper-doll renderer integrated.
- Beat-pulsing UI, screen shake, particle bursts.
- Score tuning: play through a full song with the webcam, dial the scoring feel.
- **Test invariant:** wearable never touches the score.
- **Test invariant:** camera frames never leave the browser.

**Gate:** three consecutive full playthroughs with consistent scoring, no crashes, working keyboard fallback, no BLE disconnects.

### Phase 5 — Feature Freeze + Demo Prep (H40–46)

- **Feature freeze at H40.** No new features.
- Pre-process demo videos so the pipeline runs instantly during the demo.
- Write `demo-script.md`. Rehearse three times with a stopwatch.
- Record a backup demo video.
- Test on the actual demo machine: webcam, BLE, audio, Chrome version.
- Fix only demo-blocking bugs.

**Gate:** rehearsed, timed, backed-up demo that runs clean on the demo machine.

### Phase 6 — Demo (H46–48)

- Arrive early. Set up. Verify everything in the actual room.
- Do not touch the code.
- Follow the rehearsed script.
- Have the backup video ready.

---

## 12. Risks (Ranked)

1. **MediaPipe fails on real hardware or real videos.** Mitigation: validated in Phase 1, not Phase 4. Test harness from Person C surfaces failures early.
2. **Live webcam identity switches to a spectator.** Mitigation: explicit pairing, body continuity plus session face matching, pause on uncertainty, and crossing/exit/re-entry trials before claiming multi-person support. Reference-video multi-person isolation remains deferred; reject unsuitable prep clips.
3. **Joint smoothing lags fast motion or fails to reduce jitter.** Mitigation: raw-vs-smoothed overlay as a Phase 1 gate.
4. **Web Bluetooth fails on the demo machine.** Mitigation: keyboard fallback ships from Phase 1. Never demo without it.
5. **Pictograms look bad.** Mitigation: hero pictograms from the artist as insurance.
6. **Prep pipeline takes too long per video.** Mitigation: hardcode 2–3 pre-processed videos for the demo.
7. **Piezo jitter due to BLE preemption.** Mitigation: LEDC hardware timer. Test in Phase 3.
8. **Rotary sensor noise or angle wraparound causes unintended scrolling.** Mitigation: confirm the sensor interface/travel range, filter angle changes, calibrate navigation step thresholds, and test stationary input, reversals, wraparound or endpoints. Debounce the single button separately.
9. **Hardware bring-up gets squeezed if vision runs long.** Mitigation: BLE contract frozen in Phase 0; `WearableClient.ts` built against fake source in Phase 1.

---

## 13. Definition of Done

A demo is "done" when:

- One real video flows from import → pipeline → playable chart with no manual fixups.
- The game plays end-to-end on the demo machine with a real webcam.
- Before advertising session player lock: spectator entry/crossing cannot silently
  change the scored player; ambiguity pauses play, session face data is cleared,
  and the webcam plan acceptance gates pass on the demo machine.
- The wearable clicks on beat; its rotary angle sensor scrolls menu focus over BLE and its single button selects/confirms. No wearable mouse control is required.
- Keyboard fallback works when the wearable is unplugged.
- Three consecutive playthroughs produce consistent scores.
- A backup video of the full demo exists.
- The pitch is rehearsed and timed.

---

## 14. Out of Scope

Do not build:

- User accounts, login, or OAuth.
- Leaderboards or online/multiplayer scoring.
- Cloud databases, hosted auth, or cloud GPU inference APIs.
- Video editing features.
- A custom PCB or 3D-printed enclosure.
- Additional scoring inputs beyond the webcam.
- Any feature not in this PRD without team discussion.

**In scope (clarification):** the local `/backend` song-cache API (FastAPI + SQLite + disk files, no auth) for clips, cached `dance.json`/audio, and play history — see §7.

---

**End of PRD.**
