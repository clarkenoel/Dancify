# Wearable Protocol — Dancify

**FROZEN.** Changes require integrator approval and a `[SCHEMA CHANGE]` commit.

## BLE Service

**Service UUID:** `7a2b0001-8f4c-4a6e-9b1d-3c5e7f9a0b1c`
**Device name prefix:** `Dancify-Wearable`

## Characteristics

### RX — Browser → ESP32

**UUID:** `7a2b0002-8f4c-4a6e-9b1d-3c5e7f9a0b1c`
**Properties:** Write

Browser writes UTF-8 strings. Each message is newline-terminated.

| Message | Meaning |
|---|---|
| `BPM:<int>` | Set song BPM. ESP32 fires piezo every `60000/BPM` ms. |
| `BEAT:<float>` | Initial beat phase offset in seconds. |
| `SYNC:<float>` | Resync phase. ESP32 slews offset, does not jump. |
| `HIT:1` | Fire a triple-click (scored hit moment). |
| `TONE:<int>` | Play a UI beep at frequency (Hz) for ~80ms. |

### TX — ESP32 → Browser

**UUID:** `7a2b0003-8f4c-4a6e-9b1d-3c5e7f9a0b1c`
**Properties:** Notify

ESP32 sends UTF-8 strings. Each message is newline-terminated.

| Message | Meaning |
|---|---|
| `JOY:<float>,<float>` | Joystick X,Y in `-1.0..1.0`. Sent at 5Hz (debug heartbeat). |
| `DIR:UP\|DOWN\|LEFT\|RIGHT` | Zone transition. Sent on entry. |
| `BTN:DOWN` | Button pressed. |
| `BTN:UP` | Button released. |
| `BTN:CLICK` | Short press (<500ms). |
| `BTN:HOLD` | Long press (>=500ms). |

## Timing

- ESP32 fires piezo on its own hardware timer (LEDC peripheral).
- Browser sends `SYNC:<float>` every ~5 seconds.
- ESP32 measures drift and slews its offset to correct it.
- Target: <20ms drift over 60 seconds without resync.

## Hardware Notes

- Joystick VRx, VRy on ADC1 pins only (GPIO 32–39). Never ADC2 (BLE conflict).
- SW button on a digital pin with `INPUT_PULLUP`.
- Two piezos in parallel to a single GPIO through a shared 100Ω resistor.
- Piezo driven by LEDC, never `tone()`.