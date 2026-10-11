# Wearable integration decision — proposed, not approved

Date: 2026-10-11. Tasks 4–5 of the pre-hardware work.

The browser currently receives BLE navigation/button notifications and supports
the same actions through a simulator. It does not send metronome or hit feedback.
There is no firmware implementation in this repository yet. The frozen
[protocol](../../schema/wearable.protocol.md) has no stop command and leaves the
units/epoch of phase correction ambiguous. Starting an autonomous metronome with
that interface cannot guarantee silence during pause, results or camera recovery.

This proposal requires explicit approval to unfreeze only
`schema/wearable.protocol.md`. The dance JSON schema and TypeScript chart mirror
do not change. Until approval, this document is an RFC, not a firmware contract.

## Proposed player experience

| Action/state | Wearable behavior |
|---|---|
| Rotate clockwise / counterclockwise | Next / previous menu item; keep focus visible |
| Short button press | Activate focused action, including Ready and Play again |
| Countdown, paused, tracking lost, results, menu | Metronome silent |
| Reference video playing normally | Beat clicks follow the reference beat grid |
| Finalized GOOD, SUPER or PERFECT | One triple-click per checkpoint |
| MISS, insufficient tracking, duplicate result | No hit feedback |
| Menu selection | One short confirmation beep; rotation itself is silent |
| BLE disconnect or output failure | Pause gameplay; explain reconnect or keyboard fallback |
| Reconnect | Remain paused until explicit Ready/play confirmation |

Keyboard practice may produce hit feedback for its explicitly labeled practice
judgments. It never becomes a camera score. The wearable never supplies scoring
data. Session player identification remains separate, unfinished work.

## Proposed wire contract

Keep the existing service/RX/TX UUIDs and required UTF-8 newline framing.
Reuse `DIR:DOWN` for clockwise/next and `DIR:UP` for counterclockwise/previous;
`BTN:CLICK` selects. `JOY` is legacy debug input, not required from the rotary
sensor. No new rotary message is necessary. Sensor model, wiring and physical
step calibration remain hardware-owner decisions.

Add one command: `RUN:0` stops/silences beat and hit output and discards pending
clicks; `RUN:1` enables the configured metronome. The device boots stopped and
returns to stopped on BLE loss. `BPM`, `BEAT` and `SYNC` configure timing without
implicitly enabling output. `TONE` remains a short UI beep permitted while the
metronome is stopped. `HIT` is ignored when stopped.

Define `BEAT:<float>` as nonnegative seconds until the next reference beat,
sampled from `referenceVideo.currentTime` when preparing the command. After
`RUN:1`, firmware uses this delay then the `60/BPM` period. `SYNC:<float>` uses
the same seconds-until-next-beat meaning at transmission; firmware slews its
running phase instead of firing an extra beat. These are not Unix timestamps or
browser wall-clock values. `BPM` is a positive integer (round the chart BPM).
Reconfigure on every resume/replay/seek, with old queued output invalidated.

The browser sends, in order: `RUN:0`, `BPM`, `BEAT`, then `RUN:1` only once
reference playback is actually running. While playing it sends `SYNC` roughly
every five reference-video seconds, using the next actual chart beat. Pause,
end, tracking loss, mode/song change and tab hiding request `RUN:0` immediately.
Non-unit playback speed disables feedback; normal-speed playback can resync.
No catch-up hit bursts after suspension or reconnection.

As a fail-safe, firmware should stop output if no valid `SYNC` arrives for
15 seconds while running; the browser must reconfigure to restart it. This
device safety timer is not a gameplay clock. Firmware schedules beat envelopes
without blocking and uses LEDC for the piezo waveform.

BLE delivery latency is not measured by this one-way protocol. A constant
integer BPM also approximates a variable beat grid. Physical latency and drift
must be measured before claiming the PRD's timing target. If unacceptable,
acknowledgments/timestamp negotiation need another reviewed protocol revision.

The chart has no explicit hit timestamp. `HIT:1` follows the scorer's finalized
checkpoint judgment, which may occur at window close; it must not be presented
as an exact choreographic hit-time signal. See [hit timing RFC](hit-timing-rfc.md).

## Implementation and acceptance after approval

1. Update the frozen BLE document and PRD together; retain keyboard fallback.
2. Add ordered, bounded RX writes with connection-generation cancellation,
   timeout handling and a visible output error. Never replay obsolete writes.
3. Wire output to reference playback, finalized judgments and recovery lifecycle.
4. Provide a bounded command monitor/simulator without real hardware or score
   injection. No camera frames or face descriptors in logs.
5. Test command framing/order, pause during pending writes, timeout/disconnect,
   reconnect, seek/replay, results, hidden tabs and duplicate judgments. Run all
   existing unit, build, launcher and browser checks.
6. With firmware ready, validate real BLE and audible timing on the Windows demo
   machine. Software/simulator tests cannot pass that physical hardware gate.
