# Webcam tracking and session player identification

Status: approved product direction; planned, not implemented.
Updated: 2026-10-10.

## Goal and current boundary

Keep scoring the explicitly selected player when spectators enter the webcam
view. Pair a body track with the connected controller and use a temporary face
descriptor to help confirm or reacquire that player during this session.
This is session identity continuity, not identifying someone by name or logging
into an account. A bounding box alone is not persistent identity.

The current browser implementation uses single-person MediaPipe Pose and has no
face matching, multi-person tracking, or reliable player lock. Recorded-dancer
camera tests passed; real-player scoring calibration remains necessary. Until
the gates below pass, require one person in view and do not claim crowd support.
The Python preparation pipeline still requires a stable solo-dancer reference
clip. This plan concerns the live webcam, not reference-video subject selection.

## Pairing and tracking behavior

1. Explain session-only face matching before enrollment. Ask the player to stand
   alone inside the positioning guide with their face visible and required body
   joints in frame. Declining enrollment leaves keyboard practice available.
2. The player confirms with the connected controller button, or an explicit
   on-screen/keyboard pairing action while BLE is unavailable. Accept pairing
   only when one body and one confidently associated face are present. A device
   connection/button event cannot itself prove who is wearing the armband.
3. Capture a quality-checked face reference and keep its descriptor in browser
   memory, associated with a session-local player ID and body track. Immediately
   discard enrollment images when descriptor computation is complete.
4. Track candidate bodies continuously using position and motion. Associate
   visible faces with bodies using geometry and temporal consistency; do not
   simply choose the largest/nearest face, body, or highest pose confidence.
5. Use face comparison as supporting evidence when identity becomes uncertain
   or reacquisition is needed. A turned-away or small face need not break an
   otherwise unambiguous continuous body track. If continuity is lost, do not
   guess from position alone or silently enroll a new face.
6. On ambiguous identity or lost body track, reject samples and pause reference
   playback as well as scoring. Explain the problem, seek a confident match to
   the existing reference, or offer explicit re-pairing. Resume only after
   confirmation; re-pairing starts a fresh run so two players cannot share a score.
7. Controller disconnect invalidates the device association and pauses play;
   offer explicit keyboard fallback or re-pairing. Pairing/control actions never
   award score and require no additions to the frozen BLE wire protocol.

## Privacy and lifecycle

- Face crops, descriptors and webcam frames stay on the player computer in the
  browser; no uploads to the song API, analytics, or an external inference service.
- No face data in localStorage, IndexedDB, files, logs, diagnostics, saved results,
  screenshots captured by the app, or crash reports. Spectator descriptors are
  transient matching inputs, not an enrolled roster or persistent database.
- Release references to descriptors, crops, candidate tracks and pending inference
  on session completion/exit, explicit reset/re-pair, song or camera change,
  camera shutdown, mode change, fatal camera error, and component teardown.
  JavaScript memory release is not a promise of secure byte-level erasure.
- Pause/backgrounding may retain the current session reference in memory but
  cannot score. Resume checks identity; refresh requires enrollment again.
- Replay after a completed session requires new pairing. No cross-session face
  identity, account verification, demographic inference, or model training.

## Integration invariants

- Reference video `currentTime` remains the master clock; one frame/inference in
  flight or another bounded scheduler must prevent queues of stale samples.
- Attach session/player generation and capture epoch to every inference result.
  Reject results after pause, identity loss, re-pairing, camera replacement or
  teardown, even if the same checkpoint is still open. Identity events must
  invalidate in-flight work without silently clearing prior earned results.
- Uncertain identity produces no pose sample. Insufficient pose data still returns
  `null`, never zero. Paused video produces no new judgments; ordinary missing
  pose data while playing retains the existing LOST rules. Do not award success
  merely for recognizing a face.
- Compare only the selected player's pose. If inference uses a crop, transform
  landmarks back to full-frame image coordinates before existing aspect/hip/torso
  normalization; verify parity on fixtures. Detection-box resizing must not alter
  body geometry or scoring.
- Mirrored preview and mirrored-follow-along scoring are separate choices. Specify
  and validate the scoring convention before calibration.
- Preserve immutable bundles, current checkpoint windows, keyboard practice, local
  result storage, and frozen chart/BLE contracts. Never put identity data in them.

## Delivery phases and acceptance gates

| Phase | Work | Required evidence before moving on |
|---|---|---|
| W1 — Visible tracking | Overlay the player's skeleton, confidence and current/next target; camera selector and clear error states | Real webcam follows the correct joints; preview and overlay mirror together; resources stop on exit |
| W2 — Positioning and explicit pairing | Full-body guide, enrollment explanation, stand-alone confirmation, session lifecycle; simulate controller action until BLE exists | Cannot enroll multiple/ambiguous candidates; keyboard pairing works; disconnect/reset invalidates association; no claim of automatic crowd identity yet |
| W3 — Multi-person body tracking | Evaluate local models/runtime, associate tracks across frames, select one body for pose inference, validate crop coordinates | Entrants never automatically replace the player; crossings/occlusion trigger uncertainty when needed; normalization fixture parity and acceptable laptop performance |
| W4 — Session face matching | Add quality-checked enrollment, face-to-body association and descriptor comparison for confirmation/reacquisition | Real paired-player versus spectator trials support thresholds; uncertain matches pause; turns do not cause needless switches; reference is never silently updated |
| W5 — Scoring calibration and resilience | Establish mirror convention, matching/mismatching trials, latency/performance, lost-tracking recovery and stale-result rejection | Consistent scoring across teammates, pause/seek/replay tests, identity generation tests, no spectator scoring in the test set |
| W6 — Design and demo acceptance | Connect Figma states, silhouettes and hardware pairing; rehearse complete runs | End-to-end runs on the actual Windows/WSL demo machine, keyboard fallback, lifecycle/privacy checks, documented limits |

W1–W6 describe the new webcam work, not a claim that the original 48-hour roadmap
phases have passed. Body detection, face detection/descriptor model, runtime,
asset distribution and licensing are still to be selected. Check model download
size, offline loading, CPU/GPU cost and compatibility before adding dependencies.
MediaPipe pose landmarks alone do not provide a face-identity descriptor.

## Validation scenarios

- Correct player enrolled alone; multiple candidates refuse enrollment.
- Another person enters behind, beside and in front of the player, including a
  spectator closer to the camera; identity stays correct or play pauses.
- Two bodies cross, the player turns away, arms cover the face, or illumination
  changes; small/full-body face crops and poor confidence do not cause guessing.
- Player exits and a spectator remains; spectator cannot inherit scoring.
- Original player returns; a confident match plus confirmation resumes the same
  paused run. Explicit pairing of a different player requires a new run.
- Camera/controller disconnect, device switch, background tab, seek, replay,
  finish and rapid teardown; stale results cannot revive an old identity.
- Test intentionally similar-looking participants where available. Record false
  matches, unnecessary pauses and recovery time; do not promise perfect recognition
  or authentication/spoof resistance from this demo feature.
- Inspect requests and browser storage to verify no biometric/frame persistence
  or transmission. Test offline model loading and teardown reference cleanup.
- Run the ordinary upload, preparation, keyboard and camera regression suites.
  Test before pushing; present implementation/results for review before merging.

## Remaining decisions

Choose models and measured identity thresholds; set enrollment quality criteria,
continuity/reacquisition limits and inference cadence from real trials. These are
implementation decisions to validate, not arbitrary guarantees in this document.
