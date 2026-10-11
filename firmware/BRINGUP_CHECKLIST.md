# ESP32-S3 Zero bring-up acceptance

Source: clarkenoel/justmakeit, firmware branch, b6c40000b74b86a3325d48b059aa55cbbf4ff4c0.

## Upload

1. Open DancifyWearable/DancifyWearable.ino with Controls.h and FeedbackEngine.h beside it.
2. Select Espressif ESP32 core 3.3.12, ESP32S3 Dev Module. USB CDC On Boot: Enabled. USB Mode: Hardware CDC and JTAG. Flash size: 4 MB; partition: Default 4 MB with spiffs; PSRAM: Disabled. Select the board COM port.
3. Verify, then Upload. If connecting stalls, use the board BOOT/RESET procedure, then retry. Do not infer a successful upload from a successful compile.
4. Open Serial Monitor at 115200 and reset; expected READY Dancify-Wearable; stopped. Commands require newline. Keep the buzzers silent at idle.

## Browser and controls

1. Open the localhost app in Windows desktop Chrome/Edge, enable Windows Bluetooth. USB provides power/flashing; BLE carries game controls.
2. Click the real Connect action with a mouse/touch. Choose Dancify-Wearable. Check connected state. The chooser requires browser user activation; an incoming controller event cannot initiate permission.
3. Slowly turn clockwise: focus moves next. Counterclockwise: previous. If physically reversed, set ROTARY_REVERSED=true in the sketch and re-upload.
4. Short press: exactly one selection. Hold >=500 ms: no selection. Release after long hold: no extra selection.
5. Hold the sensor still for 60 seconds: no movement. Try both limited-travel endpoints; no wrap/repeat. Reverse to move back.

## Lifecycle

1. Start a camera round. Unplug the board: the app must show disconnect and pause; no scores from continued playback.
2. Reconnect power, wait for BLE advertisement, explicitly reconnect in the app. Gameplay must remain paused until readiness/countdown. No stale button or rotary inputs should replay.
3. Repeat twice. Also close/reopen the app and reconnect. No automatic continuation of an old round.
4. Confirm the chosen short feedback cue and silence during idle, countdown, playback, pause, tracking loss and results after its one authorized cue. Firmware supports metronome/HIT, but the current browser demo disables both by default.

## Serial fallback diagnostic (BLE disconnected)

Use Newline line ending. TONE:880 gives an 80 ms pulse; RUN:0 cancels it.
For scheduler bench only: RUN:0, BPM:120, BEAT:0.5, RUN:1 on separate lines. First pulse after ~0.5 s, then twice/second. It must stop after 15 s without SYNC. RUN:1 alone must not restart it. This is a diagnostic, not the intended quiet demo sound policy.

These are pending physical checks. Cloud host tests and target compilation cannot prove Windows Bluetooth radio behavior or GPIO timing.
