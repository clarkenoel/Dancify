# Firmware — Agent Instructions

You are working on the ESP32 wearable only. Person C owns this directory.

## Scope

- Arduino C++ only. Do not touch `/web`, `/pipeline`, or `/schema`.
- BLE messages must match `wearable.protocol.md` exactly.

## Rules

- Piezo uses LEDC, never `tone()`.
- Joystick ADC pins are ADC1 only (GPIO 32–39). Never ADC2.
- Poll joystick in a FreeRTOS task, not the main loop.
- No scoring contribution. Metronome + controller only.
- Two piezos in parallel on one GPIO through a shared 100Ω resistor.

## Session Start

Confirm you are in `/firmware`. Read `PRD.md.md` §4.3 for the firmware spec.