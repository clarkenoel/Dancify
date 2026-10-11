# Wearable Protocol — Dancify

**FROZEN — feedback revision 2026-10-11.** The user authorized this BLE-only
revision on 2026-10-11. Further changes require explicit unfreezing and a
`[SCHEMA CHANGE]` commit. Dance JSON and its TypeScript mirror are unchanged.
Browser output and simulation are implemented; ESP32 firmware and physical timing
acceptance remain pending. See [decision and limits](../docs/handoffs/wearable-output-rfc.md).

## BLE service and framing

- Service: `7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c`
- Device name prefix: `Dancify-Wearable`
- RX (browser → ESP32): `7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c`, **Write with response**.
- TX (ESP32 → browser): `7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c`, **Notify**.

Every command is an ASCII UTF-8 string terminated by `\n`. Buffer partial lines;
process complete lines in order. Ignore malformed/unknown lines without changing
output state. Browser writes one command per GATT operation, serially. A GATT
write response confirms transport completion, not audible delivery or timing.

## RX commands

| Message | Meaning |
|---|---|
| `RUN:0` | Stop beat/hit output immediately; cancel pending beat/hit envelopes. |
| `RUN:1` | Enable a configured metronome. First beat follows the configured BEAT delay, then period `60/BPM` seconds. |
| `BPM:<int>` | Positive integer tempo; browser rounds chart BPM. Does not start output. |
| `BEAT:<float>` | Nonnegative seconds until the next actual chart beat, measured from reference video time when the browser dispatches this command. Does not start output. |
| `SYNC:<float>` | Same seconds-until-next-beat units at dispatch; slew running phase without an extra beat. Does not start stopped output. |
| `HIT:1` | One triple-click; ignore while stopped. |
| `TONE:<int>` | Positive frequency in Hz; UI beep for approximately 80 ms, allowed while stopped. Browser uses 880 Hz. |

Device boots stopped, stops on BLE disconnect, and stops if no valid SYNC arrives
for **15 seconds while running** (initial deadline starts at RUN:1). Restart after
this fail-safe requires the full configuration sequence below. RUN:0 invalidates
the previous BPM/BEAT configuration; RUN:1 requires fresh BPM and BEAT. Scheduling
and button/sensor handling must be nonblocking. Use LEDC for the piezo waveform.

## TX commands and rotary mapping

| Message | Meaning |
|---|---|
| `DIR:DOWN` | Clockwise rotary step → next menu item. |
| `DIR:UP` | Counterclockwise rotary step → previous menu item. |
| `BTN:CLICK` | Short press (<500 ms) → select/confirm focused item. |
| `BTN:DOWN`, `BTN:UP` | Button edges; browser ignores for activation. |
| `BTN:HOLD` | Long press (>=500 ms); no current browser action. |
| `DIR:LEFT`, `DIR:RIGHT` | Legacy previous/next aliases; rotary firmware need not send them. |
| `JOY:<float>,<float>` | Legacy joystick debug data; ignored by browser, not required. |

Filter rotary jitter and debounce the button. Sensor model, interface, travel,
step threshold and pins remain hardware-owner decisions. If analog, use ADC1
(GPIO 32–39), never ADC2. One button uses INPUT_PULLUP. Two piezos share one GPIO
through a 100Ω resistor; no joystick or mouse navigation is required.

## Browser lifecycle and timing limits

On actual normal-speed reference playback: `RUN:0`, `BPM`, `BEAT`, `RUN:1`.
Reconfigure on resume/replay/seek. While playing, send SYNC about every five
**reference-video seconds**, using the next actual chart beat. Configuration is
silent during countdown; menus, pause, tracking loss, results, buffering, tab
hiding and song/mode changes stop output. Non-unit playback speed disables it.
When there is no remaining chart beat, stop rather than inventing more beats.

One HIT follows each newly finalized GOOD/SUPER/PERFECT checkpoint during enabled
playback, in camera or explicitly labeled keyboard practice. No HIT for MISS,
LOST, old judgments after a pause/reconnect, or catch-up bursts after suspension.
Final judgments at/after playback end do not sound in results. Chart windows have
no explicit hit timestamp: HIT is judgment feedback, not exact choreography timing.
Menu activation requests TONE; rotary steps are silent. Lifecycle cancellation
may discard an obsolete queued UI tone.

The browser bounds pending writes to 32 and each write to two seconds. Stop
invalidates queued commands, then follows any already-submitted write, which
cannot be recalled. Write failure/timeout disconnects and pauses gameplay; an
explicit reconnect or keyboard fallback is required, never automatic resume.
Firmware disconnect handling and its 15-second fail-safe are necessary because
a failed radio cannot guarantee delivery of RUN:0.

One-way BLE delivery latency is unmeasured. Integer BPM approximates variable
beat grids, and BEAT-to-RUN:1 delivery introduces latency. Measure audible phase,
SYNC slewing, and the target <20 ms drift over 60 seconds on real hardware before
claiming accuracy. Software simulations cannot prove those physical targets.
