# PRD — Dancify (Wearable Rhythm Game)

**Version:** 1.1
**Last updated:** 2026-10-10
**Owner:** [Your name]
**Status:** Active development — 48-hour hackathon build

---

## 1. One-Line Summary

A Just Dance clone that works on any dance video: paste a TikTok or YouTube link, wait two minutes while a prep pipeline extracts the beat and hit moments, then play a rhythm game where the webcam tracks your body and a custom ESP32 wearable clicks the beat on your wrist and controls the game.

---

## 2. Pitch (For Demo)

> We built a Just Dance that works on any video. Paste a TikTok or YouTube link, wait two minutes while our pipeline finds the beat and the choreography's hit moments, and then play it. The webcam tracks your body — no controller, no mocap suit, no training data. And on your wrist is a custom wearable that feels the beat: it clicks on every beat so you don't need to hear the laptop, and it triple-taps when a pose scores. You can pause, change tracks, and adjust volume from your wrist without ever touching the laptop. The pictograms are hand-drawn by a real artist and turned into a paper-doll rig — infinite poses from fifteen drawings. This is a rhythm coach you wear.

---

## 3. Build Order — Vision First, Hardware Later

**This is a deliberate reordering.** The vision pipeline (MediaPipe + joint smoothing + primary subject isolation) is the highest-risk unknown and must be validated before anything else is built. The hardware (ESP32 + joystick + piezos) is a known quantity and can be built later without risk.

**Rules:**
- Hardware firmware is built in **Phase 3**, not Phase 1.
- The BLE contract (`wearable.protocol.md`) is still frozen in **Phase 0**.
- The game's `WearableClient.ts` module is built in **Phase 1** against a **fake event source**. Swapping to real BLE in Phase 3 must not require changes to the game loop.
- The game must remain fully playable with keyboard only at every phase. This is the demo-day fallback if hardware fails.

---

## 4. Product Architecture

Three independent pieces plus one shared contract layer.

### 4.1 The Prep Pipeline (Python, offline, runs once per video)

**Input:** a video file (any length, any source, front-facing, single dancer preferred).
**Output:** a `dance.json` file plus cached audio and any pictogram assets.

**Stages:**
1. Download or ingest video (local file or URL via `yt-dlp`).
2. Extract audio with `ffmpeg`.
3. Run `librosa.beat.beat_track()` for BPM and beat times.
4. Sample video at 30fps, run MediaPipe Pose on each frame → 33 landmarks per frame.
5. **Primary subject isolation:** for multi-person frames, keep only the highest-confidence / largest bounding box. Must track the correct person across the full video, not switch frame to frame.
6. **Joint smoothing:** Savitzky-Golay filter, tune window/poly per video resolution. Must reduce jitter without lagging fast motion.
7. Compute per-frame **motion energy** (weighted mean joint angular velocity; arms > legs > face).
8. Find **dips** in the motion-energy curve — these are held poses, the hit moments.
9. Snap each dip to the nearest beat or half-beat.
10. Merge consecutive hits with similar target poses (a 4-beat hold = 1 hit with a hold bar, not 4 hits).
11. Write `dance.json`.

**Required tooling:** a velocity-curve debug view showing the motion-energy curve, beat grid, and detected hit markers. If markers don't sit in the dips and on the grid, the pipeline is wrong. This is not optional — it's the only way to diagnose the pipeline.

**Required tooling:** a raw-vs-smoothed overlay view to verify joint smoothing quality.

### 4.2 The Game (TypeScript / React, runs live in the browser)

**Stack:** TypeScript, React, Canvas 2D, `@mediapipe/tasks-vision`, Web Bluetooth API.

**Runtime flow:**
1. Load `dance.json` and the audio file.
2. Turn on webcam, run MediaPipe PoseLandmarker on the live feed (GPU delegate).
3. **Master clock = `video.currentTime`** (not `performance.now()`, not `AudioContext`).
4. On each frame:
   - Read `t = video.currentTime`.
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

**The game must remain fully playable with keyboard only.** Arrow keys simulate joystick directions. Enter simulates the button. This is the demo-day fallback if Bluetooth fails.

### 4.3 The Wearable (ESP32 firmware) — Built in Phase 3

**Hardware:**
- ESP32 dev board.
- Analog joystick module (KY-023 or similar). VRx and VRy **must** connect to ADC1 pins (GPIO 32–39). ADC2 pins conflict with the BLE radio.
- Two passive piezo buzzers wired **in parallel** to a single GPIO through a shared 100Ω resistor.
- Velcro strap or sweatband for forearm mounting.

**Firmware behavior:**
- Poll joystick ADC at 50Hz from a FreeRTOS task (not the main loop — BLE starves it).
- Deadzone filter: ~15% around center, with hysteresis. Below deadzone → `(0, 0)`. Above → remap to `-1.0 .. 1.0`.
- Median filter (last 5 samples) before the deadzone to kill spikes.
- Two BLE characteristics:
  - **RX** (browser → ESP32, write): `BPM:120`, `BEAT:0.5`, `HIT:1`, `TONE:880`, `SYNC:0.512`.
  - **TX** (ESP32 → browser, notify): `JOY:x,y` at 5Hz (debug heartbeat), `DIR:UP|DOWN|LEFT|RIGHT` on zone transitions, `BTN:DOWN|UP|CLICK|HOLD`.
- **Piezo driven via the LEDC peripheral, not `tone()`.** LEDC is a hardware timer — no CPU involvement during playback, no jitter from BLE preemption.
- **Piezo timing:** browser sends `BPM` and initial `BEAT` phase once. ESP32 fires on its own hardware timer. Browser sends `SYNC` every ~5 seconds; ESP32 slews its offset (does not jump).

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

### 5.1 `dance.schema.json`

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

Landmarks are normalized to hip-center origin and torso-length scale.

### 5.2 `wearable.protocol.md`

**Service UUID:** `[TBD — assign at Phase 0]`
**RX Characteristic UUID:** `[TBD]` (browser writes)
**TX Characteristic UUID:** `[TBD]` (ESP32 notifies)

**Message formats:**
- Browser → ESP32: `BPM:<int>`, `BEAT:<float>`, `HIT:1`, `TONE:<int>`, `SYNC:<float>`
- ESP32 → browser: `JOY:<float>,<float>`, `DIR:<UP|DOWN|LEFT|RIGHT>`, `BTN:<DOWN|UP|CLICK|HOLD>`

All messages UTF-8 strings, newline-terminated optional.

---

## 6. Repo Layout

```
/
  schema/
    dance.schema.json       ← FROZEN
    types.ts                ← FROZEN
    wearable.protocol.md    ← FROZEN
  pipeline/                 ← Person A only
  web/                      ← Person B only
  firmware/                 ← Person C only
  assets/pictograms/        ← Artist only
  docs/demo-script.md       ← Integrator only
```

**Ownership rules:**
- Directory ownership is absolute.
- Shared files (`package.json`, `index.html`, `.gitignore`) are integrator-only.
- Never commit video or audio files. Use a shared Drive folder and reference paths in `.env`.
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

**No backend, no database, no server.** Static site. Host on Vercel or GitHub Pages.

---

## 8. What Does NOT Need to Happen

State explicitly so no one wastes time:

- **No model training.** MediaPipe is pretrained. `librosa` is classic DSP. Motion energy is arithmetic. Pose comparison is trigonometry.
- **No backend.** No FastAPI, no cloud GPU, no API keys.
- **No IMU.** The wearable doesn't score.
- **No motion capture suit, no depth camera, no cloud inference.**
- **No glowing hand overlay on the reference video.** The prep pipeline isolates the primary subject; there's only one dancer to follow.

---

## 9. Optional: Shot-Review + Confirmation

If time allows, add a review step between download and analysis:

- Advisory cut markers on the video timeline.
- User selects a continuous range.
- UI requires an explicit checkbox: "This range is one front-facing dancer in a single uninterrupted take."
- Backend rejects analysis without `single_front_facing_take: true`.

This de-risks the pipeline by making the user responsible for choosing a clean input. **Build only if Phase 1 gates pass with time to spare.**

---

## 10. 48-Hour Roadmap (Vision-First Ordering)

| Phase | Hours | Goal | Gate |
|---|---|---|---|
| 0 | 0–2 | Foundation | Contracts frozen, everyone committed |
| 1 | 2–14 | Vision pipeline + game skeleton | Pipeline correct on 3 videos, MediaPipe works on real webcam, subject isolation tracks correctly, joint smoothing validated |
| 2 | 14–20 | Vision end-to-end | One real video → play → score, no fake data |
| 3 | 20–30 | Hardware bring-up + integration | BLE works, piezo on beat, joystick navigates menu |
| 4 | 30–40 | Features + juice | Three consistent playthroughs, no crashes |
| 5 | 40–46 | Feature freeze + demo prep | Rehearsed, backed-up demo on demo machine |
| 6 | 46–48 | Demo | Demo happens |

**Feature freeze at H40. No exceptions.**

---

## 11. Phase Details

### Phase 0 — Foundation (H0–2)

- Freeze `dance.schema.json` and `wearable.protocol.md`.
- Scaffold repo directories.
- Commit `PRD.md`.
- Everyone pushes one trivial commit to their branch.
- **Gate:** contracts frozen, everyone committed.

### Phase 1 — Vision Pipeline + Game Skeleton (H2–14)

**This is the whole team's focus.** Everyone who can help with vision, does.

**Person A — Prep pipeline:**
- `video → ffmpeg → librosa beats → MediaPipe poses → smoothing → motion energy → hit moments → dance.json`.
- Joint smoothing: Savitzky-Golay, tune per resolution.
- Primary subject isolation: highest-confidence / largest bounding box, stable across full video.
- Velocity-curve debug view (non-negotiable).
- Raw-vs-smoothed overlay view.
- Run on 3 test videos: solo, portrait, multi-person.

**Person B — Game frontend:**
- React scaffold, fake `dance.json`, MediaPipe PoseLandmarker on webcam, skeleton render.
- Master clock = `video.currentTime`.
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

**Gates (all must pass before Phase 2):**
1. A's pipeline produces a correct `dance.json` for 3 videos, verified in the debug view.
2. Joint smoothing visibly reduces jitter without lagging fast motion (raw vs. smoothed side-by-side).
3. Primary subject isolation tracks the correct person across the full duration of a multi-person clip.
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
- Wire ESP32: joystick on ADC1 pins (GPIO 32–39), two piezos in parallel on one GPIO through shared 100Ω resistor, button on digital pin with `INPUT_PULLUP`.
- Flash firmware: BLE service up, joystick polling task at 50Hz, deadzone, `DIR:*` / `BTN:*` events over TX, `BPM`/`BEAT`/`HIT`/`SYNC`/`TONE` over RX.
- Piezo on **LEDC peripheral**, not `tone()`.
- Confirm timing: hardcoded 120 BPM for 60 seconds, measure drift. Target < 20ms over 60 seconds.
- Confirm deadzone: stick at center for 60 seconds, zero phantom events.

**Person B — Integration:**
- Swap `WearableClient.ts` from fake source to real BLE. Event stream shape unchanged.
- Wire joystick events into menu navigation.
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
2. Joystick navigates the menu. Button selects. No phantom events over 60 seconds.
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
2. **Primary subject isolation picks the wrong person in multi-person clips.** Mitigation: validated as a Phase 1 gate on a real 2-person clip.
3. **Joint smoothing lags fast motion or fails to reduce jitter.** Mitigation: raw-vs-smoothed overlay as a Phase 1 gate.
4. **Web Bluetooth fails on the demo machine.** Mitigation: keyboard fallback ships from Phase 1. Never demo without it.
5. **Pictograms look bad.** Mitigation: hero pictograms from the artist as insurance.
6. **Prep pipeline takes too long per video.** Mitigation: hardcode 2–3 pre-processed videos for the demo.
7. **Piezo jitter due to BLE preemption.** Mitigation: LEDC hardware timer. Test in Phase 3.
8. **Joystick ADC noise causes phantom directions.** Mitigation: 15% deadzone, median filter, per-unit calibration.
9. **Hardware bring-up gets squeezed if vision runs long.** Mitigation: BLE contract frozen in Phase 0; `WearableClient.ts` built against fake source in Phase 1.

---

## 13. Definition of Done

A demo is "done" when:

- One real video flows from import → pipeline → playable chart with no manual fixups.
- The game plays end-to-end on the demo machine with a real webcam.
- The wearable clicks on beat and navigates the menu over BLE.
- Keyboard fallback works when the wearable is unplugged.
- Three consecutive playthroughs produce consistent scores.
- A backup video of the full demo exists.
- The pitch is rehearsed and timed.

---

## 14. Out of Scope

Do not build:

- User accounts, login, or persistence.
- Leaderboards or online scoring.
- A backend or database.
- Video editing features.
- A custom PCB or 3D-printed enclosure.
- Additional scoring inputs beyond the webcam.
- Any feature not in this PRD without team discussion.

---

**End of PRD.**