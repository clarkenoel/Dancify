# Wearable feedback — browser implementation and hardware handoff

Date: 2026-10-11. Tasks 4–5 of the pre-hardware work.
Developed on `feat/codex-web-followup`. The user authorized the BLE revision and
subsequently approved publishing and merging the reviewed work on 2026-10-11.

## Contract and delivered behavior

The revised [protocol](../../schema/wearable.protocol.md) is authoritative and
re-frozen. Service/RX/TX UUIDs and required UTF-8 newline framing are unchanged.
Dance JSON and its TypeScript mirror remain frozen and unchanged.

| Action/state | Wearable behavior |
|---|---|
| Clockwise / counterclockwise rotary step | DIR:DOWN / DIR:UP moves visible menu focus next / previous |
| BTN:CLICK | Activate focused action |
| Menu selection | Request one short TONE:880; rotation is silent |
| Normal reference playback | RUN:0, rounded BPM, BEAT delay, RUN:1; SYNC about every five video seconds |
| Newly finalized GOOD/SUPER/PERFECT | One HIT:1 per checkpoint while feedback is enabled |
| MISS, LOST, duplicate or old results | No hit feedback |
| Countdown, pause, buffering, tracking loss, results, hidden tab, song/mode change | Metronome/hit output stopped; discard queued stale commands |
| Non-unit playback speed or no future chart beat | Disable feedback; do not extrapolate extra beats |
| BLE loss or write error | Pause game; explicit reconnect or keyboard fallback |
| Reconnect | Remain paused; no stale command replay |

BEAT and SYNC are seconds until the next actual chart beat, sampled from
referenceVideo.currentTime at dispatch. They are not Unix timestamps or browser
wall-clock phase. The wall clock detects scheduler suspension only; it does not
schedule game beats. Gaps over 1.5 seconds discard accumulated hit notifications
and reconfigure timing. Scoring is unchanged.

Keyboard practice may produce feedback for its clearly labeled practice
judgments. The simulator never injects poses or scores. The wearable neither
contributes scoring data nor identifies who is wearing it.

## Implementation

- `web/src/core/WearableClient.ts`: sole Web Bluetooth boundary; discovers RX and
  TX, sends an initial stop, writes serially with response, bounds pending output
  to 32 commands, times out each write after two seconds. Generation/queue epochs
  discard stale work. Errors disconnect and use the existing gameplay recovery.
- `web/src/core/wearableFeedback.ts`: reference playback lifecycle, beat phase,
  finalized result deduplication, replay/seek/visibility/speed handling.
- `web/src/hooks/useGame.ts`: connects feedback to the existing session snapshot
  updates and lifecycle without changing the session/scoring engine.
- `web/src/App.tsx`: selection tones for enabled controller-menu actions, shared
  by mouse, keyboard and BLE activation.
- `web/src/components/WearablePanel.tsx`: explicit simulated ESP32 connection and
  the last 200 successfully dispatched commands. Clearable, memory-only, no body
  or face data. Simulator uses the same output queue as BLE.

An already-submitted GATT operation cannot be recalled. A stop replaces queued
work and follows the in-flight write; a rejected/timed-out write disconnects.
Firmware must silence on disconnection and stop after 15 seconds without SYNC
while running. It must boot stopped, ignore HIT while stopped, and require fresh
BPM/BEAT after RUN:0 before RUN:1. No firmware implementation exists in this repo.

## Verification and acceptance

Automated coverage includes newline framing/RX discovery, serialized ordering,
phase sampled at dispatch, pause during an outstanding write, write rejection,
timeout, queue overflow, late completion, reconnect, bounded monitor, duplicate
judgments, camera and keyboard separation, pause/replay/seek, background, buffering,
results, playback speed and scheduler suspension. Browser integration exercises
the simulator with a real prepared video, keyboard-practice checkpoint input,
results, replay countdown and reconnect. Existing camera/model, preparation,
navigation, launcher and frontend checks must continue passing.

Completed local validation on 2026-10-11:

- Frontend: 104 unit tests passed; TypeScript and Vite production build passed.
- Launcher: all 8 tests passed.
- Browser: launch preflight and all 9 integration scenarios passed against a fresh
  database with real prepared media and the actual local pose model. Includes
  BLE initial-write failure recovery and simulator replay/reconnect.
- `git diff --check` passed. No new dependencies or scoring/schema-chart changes.

These are local validation results. See the associated pull request for GitHub
checks on the published commit. Physical hardware acceptance remains pending.

For local commands and demo steps see [web README](../../web/README.md) and
[teammate checklist](../../web/TEAMMATE_TEST.md). Physical Windows/ESP32 tests are
still required; passing mocks or simulator tests cannot pass that gate.

## Hardware gate and limitations

Implement firmware against the revised contract before connecting it to this
browser. Old firmware that ignores RUN is incompatible and cannot guarantee
silence. The current protocol has no application-version negotiation; a successful
GATT write does not prove command parsing or audible behavior.

Measure actual beat/hit envelopes, UI tone, stop latency, reconnect silence,
15-second timeout, sensor jitter/wraparound, SYNC slewing and drift on Windows.
LEDC generates the piezo waveform; envelope scheduling must remain nonblocking.
The target <20 ms drift over 60 seconds is unverified. One-way BLE latency and
the BEAT-to-RUN:1 write delay are not compensated, and integer BPM approximates a
variable beat grid. If measured timing is inadequate, acknowledgments/timestamp
negotiation need a separately reviewed protocol revision.

The chart has no explicit hit timestamp. HIT follows the scorer's finalized
checkpoint judgment (often window close), not an exact choreographic hit. End-of-
playback judgments remain visible in results but do not sound after output stops.
See [hit timing RFC](hit-timing-rfc.md). Player identity, illustrated assets and
scoring calibration remain separate tasks.
