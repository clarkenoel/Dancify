# Firmware build verification — 2026-10-11

Source: clarkenoel/justmakeit firmware branch, commit b6c40000b74b86a3325d48b059aa55cbbf4ff4c0. The sketch and both headers are unchanged.

## Passed in this cloud workspace

- Arduino CLI 1.5.2-rc.1 and Espressif Arduino core 3.3.12.
- Target: esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,FlashSize=4M,PartitionScheme=default,PSRAM=disabled
- Target compilation and linking succeeded with warnings enabled.
- Sketch uses 606,909 bytes (46%) of 1,310,720 bytes available program storage.
- Global variables use 28,352 bytes (8%) of 327,680 bytes RAM.
- All 17 host invariant test groups pass with -Wall -Wextra -Werror -pedantic.
- The same 17 groups pass with address and undefined-behavior sanitizers.
- Buzzer software bench passes cadence, pulse width, HIT pattern, stop and timeout checks.

## Build warning

BLE2902 is deprecated by the core's NimBLE compatibility layer. The existing wrapper still associates with the characteristic and the build succeeds; future library upgrades should replace the deprecated descriptor use. This warning is not evidence of a radio or notification failure. Pin core 3.3.12 for this demo.

## Still requires the Windows machine and physical board

Upload on the user's confirmed COM8, observe boot, connect in Windows Chrome/Edge, test direction/button behavior, disconnect/reconnect, physical buzzer response and idle jitter. Neither host tests nor compilation establish physical acceptance.

The earlier Windows compiler failure is recorded in VALIDATION.md. This report records the subsequent successful Linux target build; it does not claim that the Windows toolchain has been repaired. Prefer Arduino IDE Verify/Upload using this directory's DancifyWearable sketch.
