# Firmware — Agent Instructions

You are working on the ESP32 wearable only. Person C owns this directory.

## Scope

- Arduino C++ only. Do not touch `/web`, `/pipeline`, or `/schema`.
- BLE messages must match `../schema/wearable.protocol.md` exactly. The 2026-10-11 rotary/output revision is re-frozen: implement RUN, seconds-until-next-beat timing, disconnect silence and the 15-second SYNC fail-safe. See `../docs/handoffs/wearable-output-rfc.md` for browser acceptance and physical tests still required.

## Rules

- Confirmed ESP32-S3 Zero hardware uses active buzzers with nonblocking ON/OFF envelopes on GPIO 7. The optional passive-piezo build uses LEDC, never Arduino `tone()`.
- Hardware is a rotary angle sensor and one button; no joystick or mouse cursor. Confirm model, interface and travel range before assigning pins.
- The confirmed Grove limited-travel analog sensor uses GPIO 8, an ADC1 pin on the S3. GPIO 32–39 guidance was for the original ESP32; do not apply that pin map to this board. The button is GPIO 10.
- Sample the sensor in a scheduled nonblocking task; suppress stationary jitter and handle wraparound or endpoints according to the actual hardware.
- No scoring contribution. Metronome + controller only.
- Preserve the hardware owner's tested active-buzzer power/driver circuit. GPIO 7 is its control signal; do not assume it can power two bare buzzers directly.

## Session Start

Confirm you are in `/firmware`. Read `PRD.md.md` §4.3 for the firmware spec.
