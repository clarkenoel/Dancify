# Firmware validation - 2026-10-11

## Passed

- Production FeedbackEngine and Controls headers compiled with a host C++ compiler.
- All 17 invariant test groups passed, including command framing, invalid input,
  configuration gating, stop, synchronization timeout, phase correction, missed
  beats, button debounce/hold and rotary jitter/endpoints.
- Buzzer software bench passed at 60, 120 and 180 BPM: simulated beat periods of
  1000, 500 and 333.333 ms, with 40 ms pulses. Triple HIT, 80 ms menu beep, STOP
  cancellation and the 15-second SYNC timeout also passed.
- See `buzzer-test-results.txt` for the simulated trace. This is not measured GPIO
  output or a timing guarantee on an ESP32.
- The original firmware acknowledged PING, both BPM commands and STOP over USB.
- After correcting a wiring issue, the hardware owner confirmed that the isolated
  buzzer diagnostic sounded correctly. This establishes basic buzzer operation,
  not acceptance of the integrated BLE firmware.

## Still required

The local Arduino CLI target build was blocked before compilation by a Windows
`Illegal System DLL Relocation` error launching the installed Xtensa compiler.
The standalone compiler also could not run `--version`. The target was
`esp32:esp32:esp32s3`, using Espressif Arduino core 3.3.12.

Compile and upload DancifyWearable using a working ESP32 toolchain. Then validate
real website/BLE pairing, menu inputs, synchronized pulses, pause/end/disconnect
silence, reconnect, and missing-SYNC timeout on the ESP32-S3 Zero. Actual latency,
pulse response and the repository's <20 ms drift target remain unmeasured.

The hardware owner confirmed active buzzers and S3 GPIO 7/8/10. Active buzzers use
ON/OFF envelopes and cannot reproduce the requested TONE pitch. The optional
passive-piezo LEDC path is included but not hardware-verified. No silent haptic
mode is implemented; it requires appropriate actuator hardware.

Only firmware files are included. No web, pipeline, backend or schema changes,
additional dependencies, generated binaries, or scoring changes are required.
