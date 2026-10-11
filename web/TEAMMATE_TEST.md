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
| First camera round | Choose a song, enable camera, allow permission, start too close, then step back | One second of stable full-body visibility automatically starts 3–2–1, without Ready/controller input |
| Start | Stay fully in frame during countdown | Video and score stay paused during 3–2–1; playback then starts automatically |
| Countdown framing loss | Step out during countdown, then return | Countdown cancels; stable full-body tracking restarts from three |
| Deliberate pause | Pause round or cancel countdown and stay in view | Remains paused; use Ready to resume |
| End and replay | Complete a round, select Play again | Final score appears automatically without Save; replay resets score/log and counts down before starting |
| Song navigation | Choose another song, then return to Main menu | Correct view appears; old camera stream stops and old score does not carry forward |
| Framing loss | Move out of frame while playing, then return | Playback pauses after the framing-loss grace period; return alone does not auto-resume; Ready/countdown resumes |
| Camera recovery | Stop camera during play; separately unplug an external webcam | Playback pauses, feedback explains recovery; enabling a working camera requires readiness again |
| Background tab | Start a countdown or round, switch tabs, then return | Playback/countdown stops; no surprise restart |
| Camera required | Deny camera access; try Enter, Space, R and arrow keys outside controls | Retry/menu exit remain available; no keyboard practice or hit control exists, no playback or points without camera readiness |
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
Continue without controller. Reconnect without restarting the page; reconnect must not
start playback automatically. Simulator/browser mocks do not validate radio
reliability. Browser output uses the revised 2026-10-11 protocol; old firmware
without RUN is incompatible. Validate normal playback beats, one triple-click per
successful finalized checkpoint, silent MISS/LOST, selection tone, pause/countdown/
results silence, and clean replay/seek resynchronization. Test loss of SYNC for
15 seconds and BLE disconnect silence. Measure audible phase and 60-second drift;
software logs cannot establish the physical timing target.

## Identity gate (future runtime; not available in the game yet)

- Enrollment refuses multiple bodies/faces or poor framing; button/on-screen
  confirmation pairs exactly one player for that run.
- A spectator entering either side never becomes the scored player.
- Crossings, overlap and uncertain identity pause playback/scoring; test a person
  leaving behind another at the same position, including obscured/turned faces.
- A returning player requires explicit confirmation plus readiness/countdown;
  another person cannot inherit the score. Re-pairing starts a fresh run.
- Replay, exit, camera changes and completion clear enrollment. No face data
  appears in exported logs, browser storage or API requests.
- Test actual lighting, glasses, head turns, fast motion and device performance.
  Record false pauses or incorrect matches without collecting face recordings.

These tests are acceptance work for the team on physical equipment. Automated
tests cover software behavior but do not establish real recognition accuracy,
physical webcam recovery, Bluetooth reliability or scoring calibration.


## Feedback simulator (before hardware)

1. Open Controller connection and testing, connect the simulated ESP32 and expand
   Wearable command monitor. Expect RUN:0; no automatic playback or score change.
2. Choose a prepared song, play at normal speed, and inspect RUN:0, BPM, BEAT,
   RUN:1. A SYNC arrives about every five video seconds while beats remain.
3. Enable the camera and match a target. A finalized GOOD/SUPER/PERFECT sends
   one HIT; MISS/LOST do not. No repeated HIT when the display refreshes. Controls
   cannot supply pose samples or camera scores.
4. Pause, hide the tab, stop the camera, or leave the body frame: expect stop and
   no stale hit burst on resumption. At results expect RUN:0. Play again must keep
   feedback stopped during countdown and configure it after playback starts.
5. Disconnect during play, then reconnect: video must stay paused. Verify the
   explicit Continue without controller still works. Clear commands only clears the monitor.

Record any failure with song/bundle, mode and video time. Simulator commands stay
in memory (last 200); they are not physical piezo or scoring-accuracy measurements.

## Illustrated targets

- Open a ready song: Lenny should appear in the timing overlay and upcoming targets;
  Camera scoring uses the same artwork beside the webcam.
- Switch **Target character** to Human: it should have blue fill/dark outlines.
  Switch back to Lenny: it should have green skin and cream scutes/horns.
- Pause, note the video time/score, then toggle **Show target skeleton instead of
  artwork** twice. Video time, score and camera state must remain unchanged.
- Review an asymmetric pose: its raised arm must stay on the same screen side as
  the original chart skeleton. The webcam itself remains mirrored.
- Play a camera round, see immediate results, replay through countdown, and switch
  songs. Watch for missing parts, clipped hands/feet and overlapping limbs.
- Ask the designer to review `/debug/pictograms.html` on the local Vite server.
  Upload the demo's prepared `dance.json` to compare artwork and skeleton for each
  checkpoint. This gallery is diagnostic and produces no scores.

## First-draft pages

- Review main menu, library, import, gameplay, countdown, confirmation and results
  at 1440 × 900, 1920 × 1080, and a smaller laptop window. Compare with the latest
  Figma revision; current larger button dimensions are provisional.
- Read labels from the dance position. Check the two bundled fonts, focus outlines,
  long song titles, narrow layouts, and browser zoom.
- Confirm before leaving/restarting an active round; Escape cancels, restores
  focus, and leaves playback paused. Results navigation needs no confirmation.
- Import a real local clip. Confirm actual preparation stages and successful
  loading; test service failure/retry and upload fallback after download failure.
