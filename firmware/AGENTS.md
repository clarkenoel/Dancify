# Firmware — Agent Instructions

You are working on the ESP32 wearable only. Person C owns this directory.

## Scope

- Arduino C++ only. Do not touch `/web`, `/pipeline`, or `/schema`.
- BLE messages must match `../schema/wearable.protocol.md` exactly. Its rotary/output revision is authorized in `../docs/handoffs/wearable-output-rfc.md`, but proposed new commands are not the wire contract until the protocol revision is completed.

## Rules

- Piezo uses LEDC, never `tone()`.
- Hardware is a rotary angle sensor and one button; no joystick or mouse cursor. Confirm model, interface and travel range before assigning pins.
- If the sensor has analog output, use ADC1-capable pins (GPIO 32–39), never ADC2.
- Sample the sensor in a scheduled nonblocking task; suppress stationary jitter and handle wraparound or endpoints according to the actual hardware.
- No scoring contribution. Metronome + controller only.
- Two piezos in parallel on one GPIO through a shared 100Ω resistor.

## Session Start

Confirm you are in `/firmware`. Read `PRD.md.md` §4.3 for the firmware spec.
