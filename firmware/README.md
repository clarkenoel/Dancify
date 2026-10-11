# Dancify wearable firmware

This replaces the pasted Nordic UART sketch with the protocol already used by
`clarkenoel/justmakeit` main at `a213c4e7262b737ca8b2d42183fbea21e264e1ad`.
Implements the existing website protocol. Integrated hardware acceptance remains pending.

## Your hardware

- Waveshare ESP32-S3 Zero.
- GPIO 7: existing active-buzzer control output; active HIGH by default.
- GPIO 10: button to ground, internal pull-up enabled.
- GPIO 8: Grove Rotary Angle Sensor analog signal. Power the sensor from 3.3 V
  and share ground. Its output spans 0 to its supply voltage.
- Limited sensor travel: no wrapping, endpoint auto-repeat or automatic recenter.

GPIO 8 is ADC1 on the S3. The repository's GPIO 32–39 guidance applies to the
original ESP32, not this confirmed S3 board. The repository also assumed passive
piezos; your confirmed active buzzers use ON/OFF pulses. Keep their existing
power/driver circuit: GPIO 7 is a control signal, not a specification for powering
two bare buzzers. Check the actual buzzer current rating if wired directly.

Hardware references: [Waveshare board documentation](https://www.waveshare.com/wiki/ESP32-S3-Zero),
[Seeed Grove Rotary Angle Sensor](https://wiki.seeedstudio.com/Grove-Rotary_Angle_Sensor/).

## Install and connect

1. In the firmware directory, keep `DancifyWearable.ino`, `FeedbackEngine.h`, and `Controls.h`
   together inside the `DancifyWearable` folder. Open the `.ino` in Arduino IDE.
2. Select **ESP32S3 Dev Module**, using the Espressif ESP32 board package. The
   local package used for the attempted build was 3.3.12. Enable **USB CDC On Boot**
   and select **Hardware CDC and JTAG** for USB mode. Match flash/PSRAM settings to
   your board variant; this firmware does not need PSRAM. Select its COM port.
3. Compile and upload. On first upload, use the board's BOOT/RESET procedure if
   required. Serial Monitor at 115200 should print `READY Dancify-Wearable`.
4. Open the existing Dancify website in desktop Chrome/Edge on localhost or HTTPS.
   Use its real wearable connection action and select **Dancify-Wearable**.
5. Rotate to move menu focus, then short-press to select. Start normal-speed
   reference playback: the website sends tempo and phase automatically.

Only libraries bundled with the ESP32 Arduino board package are used.

## Behavior and settings

- Advertises the website's service `7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c`, with
  RX `...0002...` supporting writes with response and TX `...0003...` notifying.
- Accepts newline-terminated `RUN`, `BPM`, `BEAT`, `SYNC`, `HIT`, and `TONE`.
  Split and combined lines work. Malformed/unknown lines are ignored.
- `RUN:0` cancels sound and invalidates old tempo/phase. `BPM` and `BEAT` configure
  silently. `RUN:1` requires both fresh values and starts after the BEAT delay.
- Beat pulses last 40 ms, shortened at unusually high tempos. At 120 BPM the
  interval is 500 ms. HIT is three 20 ms pulses separated by 20 ms gaps; overlapping
  HIT requests during an existing triple-click are dropped, never queued.
- HIT has envelope priority over TONE, which has priority over a beat. The beat
  clock continues underneath; missed envelopes are not replayed.
- `TONE:880` emits an 80 ms confirmation beep even in menus. Active buzzers retain
  their built-in pitch, so 880 Hz and hit/beat frequencies are not reproduced.
- SYNC adjusts phase gradually by at most 2 ms per beat (or 5% of a beat for very
  short intervals). Disconnect and 15 seconds without SYNC stop output and
  invalidate configuration. Reconnect stays stopped until freshly configured.
- A separate FreeRTOS task schedules sound and receives commands without waiting
  for menu notifications. RX queue overflow stops output and drops incomplete data.
- The sensor is sampled every 10 ms, averaged and smoothed. About 180 ADC counts
  of movement produces a menu step, limited to one per 80 ms. Stationary jitter
  is suppressed. Reversing the knob moves focus back; at an endpoint you must
  rotate back. This is a relative control, not an endless encoder.
- Short press (<500 ms): `BTN:CLICK` on release. Long press: one `BTN:HOLD`, with
  no activation in the current website. Press/release edges are also sent.

If rotation is backwards, set `ROTARY_REVERSED = true` in the sketch. Adjust
`Rotary::STEP_COUNTS` in `Controls.h` for sensitivity. If your existing buzzer
driver is active LOW, set `BUZZER_ACTIVE_LOW = true`.

The optional `ACTIVE_BUZZER = false` path is for passive piezos driven by LEDC,
not your present hardware. It follows the [Espressif LEDC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html).

Numeric parsing accepts positive integer BPM up to INT32_MAX, nonnegative decimal
BEAT/SYNC delays up to 86,400 seconds, and TONE frequencies 1–20,000 Hz. Extremely
high BPM has no useful audible pulse. The old `BPM 120`, `START`, `STOP`, `PING`,
`STATUS`, `BUTTON 1` and raw `POT` protocol is replaced, not mixed with the website
protocol. Diagnostics go to Serial; TX carries only controller events.

## Bench test

With BLE disconnected, Serial Monitor can send the same commands. Select **Newline**
line endings and send, in order:

```text
RUN:0
BPM:120
BEAT:0.5
RUN:1
```

Expect the first pulse approximately half a second after RUN:1, then two pulses
per second. `HIT:1` tests the triple pulse; `RUN:0` must silence it. `TONE:880`
tests the menu beep while stopped. Without SYNC, the metronome intentionally stops
15 seconds after RUN:1. Serial commands are ignored during BLE connections, so
bench commands cannot fight the game. Set `USB_COMMANDS = false` for BLE-only use.

On the actual website, verify rotation direction, one activation per short press,
no long-press activation, silence during countdown/pause/buffering/end, and silence
after Bluetooth loss. Resume should receive a fresh configuration. Listen/measure
over a full song and test sensor endpoints and stationary jitter.

## Validation and limits

The C++ tests in `tests/firmware_tests.cpp` exercise the same scheduler, parser and
controls headers as the sketch. They cover framing, malformed commands, start/stop,
timeout/reconfiguration, phase slewing, skipped beats, triple pulses, 60-second
simulated cadence, button debounce/hold/millis rollover, and rotary jitter/endpoints.
Build with a host C++ compiler, for example:

```sh
c++ -std=c++14 tests/firmware_tests.cpp -o firmware_tests
./firmware_tests
```

ESP32 target build command (adjust flash settings for your variant):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,FlashSize=4M,PartitionScheme=default,PSRAM=disabled DancifyWearable
```

The local ESP32 build attempt could not start the installed Xtensa compiler:
Windows reported `Illegal System DLL Relocation`. Consequently this is **not a
confirmed ESP32 compile or hardware test**. Build in Arduino IDE before flashing.
The validation report records the completed host test result.

BLE latency, FreeRTOS scheduling jitter, audible response and drift remain
unmeasured. The video is the game's master clock; the wearable follows its phase
updates. Integer BPM and one-way BLE delays cannot guarantee exact audio alignment.
The firmware supplies no scoring data.
