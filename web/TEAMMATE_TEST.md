# Teammate test: before hardware and final designs

Run in Windows Chrome or Edge using the existing local launcher. Keep its terminal
open. Use a prepared short solo-dancer song with music and enough room for the
player's shoulders, wrists, hips, knees and ankles to remain visible. Keep one
person in the webcam view: live player identification is not implemented yet.

Record the branch/commit, browser version, camera, song/bundle, scoring mode and
whether each case passed. Current local changes must first be reviewed and
delivered to the test machine; do not assume the remote branch includes them.

## Current functionality

| Test | Actions | Expected result |
| --- | --- | --- |
| First camera round | Choose camera scoring, enable camera, allow permission, start too close, then step back | One second of stable full-body visibility automatically starts 3–2–1, without Ready/controller input |
| Start | Stay fully in frame during countdown | Video and score stay paused during 3–2–1; playback then starts automatically |
| Countdown framing loss | Step out during countdown, then return | Countdown cancels; stable full-body tracking restarts from three |
| Deliberate pause | Pause round or cancel countdown and stay in view | Remains paused; use Ready to resume |
| End and replay | Complete a round, select Play again | Final score appears automatically without Save; replay resets score/log and counts down before starting |
| Song navigation | Choose another song, then return to Main menu | Correct view appears; old camera stream stops and old score does not carry forward |
| Framing loss | Move out of frame while playing, then return | Playback pauses after the framing-loss grace period; return alone does not auto-resume; Ready/countdown resumes |
| Camera recovery | Stop camera during play; separately unplug an external webcam | Playback pauses, feedback explains recovery; enabling a working camera requires readiness again |
| Background tab | Start a countdown or round, switch tabs, then return | Playback/countdown stops; no surprise restart |
| Keyboard fallback | Deny camera access, switch to Keyboard practice | Song remains playable; Enter/on-screen hit scores practice checkpoints and results identify practice mode |
| Menu simulator | Open Controller connection and testing; use Previous item, Next item, Select item | Visible focus moves among enabled marked actions; selection opens the focused song/action |
| Keyboard menus | Use Up/Down outside a text field, then Enter | Focus/selection works; typing in form fields retains normal editing |
| Body diagnostics | Complete a moving round and a standing-still round; download each log before replay | Logs contain body sample decisions and checkpoint timestamps; compare unexpected judgments without changing thresholds yet |

For a failed case, record the exact action, expected/actual behavior, song and
approximate reference-video time, plus relevant console error text. Attach a body
movement log only when useful and intentionally shared. Do not record or share
camera images or face information for routine diagnostics. An unchanged pose can
legitimately match a stationary target; a whole-round PERFECT against changing
targets needs investigation.

## Hardware gate (when the ESP32 arrives)

Connect through the browser's Connect ESP32 action. Confirm the frozen UUIDs and
`Dancify-Wearable` advertised name prefix with the firmware teammate. Test actual
rotation in both directions, selection, rapid inputs and 60 stationary seconds.
Disconnect during playback and countdown: the game must pause and offer explicit
keyboard fallback. Reconnect without restarting the page; reconnect must not
start playback automatically. Simulator/browser mocks do not validate radio
reliability. Browser-to-device beat/piezo output still needs implementation.

## Identity gate (future runtime; not available in the game yet)

- Enrollment refuses multiple bodies/faces or poor framing; button/on-screen
  confirmation pairs exactly one player for that run.
- A spectator entering either side never becomes the scored player.
- Crossings, overlap and uncertain identity pause playback/scoring; test a person
  leaving behind another at the same position, including obscured/turned faces.
- A returning player requires explicit confirmation plus readiness/countdown;
  another person cannot inherit the score. Re-pairing starts a fresh run.
- Replay, exit, camera/mode changes and completion clear enrollment. No face data
  appears in exported logs, browser storage or API requests.
- Test actual lighting, glasses, head turns, fast motion and device performance.
  Record false pauses or incorrect matches without collecting face recordings.

These tests are acceptance work for the team on physical equipment. Automated
tests cover software behavior but do not establish real recognition accuracy,
physical webcam recovery, Bluetooth reliability or scoring calibration.
