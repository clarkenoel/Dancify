# Landmark normalization handshake (Person A ↔ Person B)

Also read [`WEB_HANDOFF.md`](WEB_HANDOFF.md) for how to load cached charts from the song-cache API.

Chart `keyframe_landmarks` are **not** raw MediaPipe image coordinates.

For each frame / keyframe:

1. Input is MediaPipe Pose's 33-landmark **image-space** result in canonical
   MediaPipe ordering. Do not substitute world landmarks.
2. Convert image coordinates to aspect-aware height units before centering:
   `x *= frame_width / frame_height` and
   `z *= frame_width / frame_height`; `y` is unchanged.
3. **Hip center** = midpoint of MediaPipe landmarks **23 (LEFT_HIP)** and **24 (RIGHT_HIP)** in `(x, y, z)`.
4. **Shoulder midpoint** = midpoint of **11 (LEFT_SHOULDER)** and **12 (RIGHT_SHOULDER)**.
5. **Torso scale** = Euclidean length of `(shoulder_mid − hip_center)`. A
   missing/non-finite/near-zero torso invalidates the frame.
6. For every landmark `i`:
   `(x', y', z') = (p_i − hip_center) / torso_scale`;
   `visibility` is copied unchanged.

Live webcam poses in `/web` **must apply the same transform** before pose comparison, or scores will be silently wrong.

Smoothing (Savitzky–Golay) is applied **before** normalization in the prep pipeline. The game may smooth live poses independently; comparison should still use this normalized space.

## Browser compatibility rules

- Use the actual inference-frame dimensions, not CSS display dimensions.
- A mirrored selfie preview must not change model semantics. Prefer inference on
  the unmirrored camera frame and mirror only the rendered preview. If inference
  receives a mirrored frame, unmirror `x` and restore canonical left/right
  landmark indices before normalization.
- `LEFT_*` and `RIGHT_*` always mean the detected person's anatomical sides,
  not the viewer's screen sides.
- The reference pipeline currently uses MediaPipe Pose `0.10.18`, model
  complexity 1. Browser implementations should record their model/version in
  diagnostics because model changes can shift visibility and coordinates.
- Visibility threshold is `0.35`. A comparable frame requires landmarks
  11–12 and 23–24 plus at least six visible gameplay joints among
  11–16 and 23–28.
- Missing/non-finite geometry or torso scale below `1e-6` returns tracking lost
  (`null`), never a numerical score or miss.

Golden portrait and landscape vectors live in
[`fixtures/pose-normalization.json`](fixtures/pose-normalization.json). The
same expanded vectors must pass Python and TypeScript contract tests.

Offline tracking requires the torso plus at least six gameplay joints at
visibility ≥ 0.35. Only short bounded gaps (about 100 ms) are interpolated;
long gaps remain invalid and are excluded from smoothing, energy, and hits.
All-zero or low-visibility keyframes are rejected.

Timeline: all `beat_times`, move `start`/`end`, and extracted audio are on the
zero-based reference-video timeline. Gameplay reads the reference
`HTMLVideoElement.currentTime` as its sole master clock.
