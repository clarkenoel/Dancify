# Webcam W1 implementation handoff

Status: implemented locally on `feat/codex-web-followup`; real-player acceptance
pending. No session face matching, enrollment, multi-person lock or BLE changes.
See [the full plan](../plans/webcam-player-lock.md) for subsequent phases.

- `web/src/core/camera.ts`: selected-device capture, transient frozen inference
  frame, disconnect/stall errors, and safe cleanup of delayed camera requests.
- `web/src/core/cameraPreview.ts`: full-body visibility guidance, diagnostic
  skeleton drawing on the matching frame, and actionable camera error messages.
- `web/src/hooks/useCamera.ts`: device enumeration, camera lifecycle generations,
  enable/stop/switch actions, preview cleanup and tracking feedback.
- `web/src/hooks/useGame.ts`: scoring remains video-clock driven; camera changes
  pause playback and invalidate in-flight samples via the existing epoch rules.
- `web/src/components/CameraPanel.tsx`: native diagnostic interface showing the
  mirrored player skeleton beside the current/next target pose. No Figma artwork
  or visual system has been invented.
- `web/src/components/GamePanel.tsx`: integrates the camera panel while keeping
  keyboard practice, timeline overlay and results unchanged.

No raw frames are saved by the application or sent over the network. Preview
canvases are cleared when the camera stops. Automated tests save a screenshot of
public recorded dancer test footage only; do not use personal webcam recordings
for those fixtures without explicit authorization.

The static target and preview retain their existing comparison convention;
real-player testing must resolve follow-along mirroring before calibration.
Browser software rendering is not representative of a physical laptop webcam's
latency. Keep the player alone in frame until identity gates are implemented.

## Validation

- 28 frontend unit tests passed, including finite/in-frame skeleton geometry,
  frozen-frame drawing order, actionable camera errors and late-permission cleanup.
- Production TypeScript/Vite build passed.
- Five Chromium scenarios passed: playback/idempotent save, local pose inference
  with rendered skeleton plus camera switching/cleanup, real upload preparation,
  provider fallback, and denied camera permission with keyboard recovery.
- Inspected the captured diagnostic preview: skeleton joints align with the
  recorded dancer; target pose and framing feedback remain visible alongside it.
- No physical human webcam trial, face identification, multi-person tracking or
  real multi-device hardware acceptance is claimed by these automated tests.
