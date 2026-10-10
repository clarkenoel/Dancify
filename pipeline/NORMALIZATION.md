# Landmark normalization handshake (Person A ↔ Person B)

Also read [`WEB_HANDOFF.md`](WEB_HANDOFF.md) for how to load cached charts from the song-cache API.

Chart `keyframe_landmarks` are **not** raw MediaPipe image coordinates.

For each frame / keyframe:

1. **Hip center** = midpoint of MediaPipe landmarks **23 (LEFT_HIP)** and **24 (RIGHT_HIP)** in `(x, y, z)`.
2. **Shoulder midpoint** = midpoint of **11 (LEFT_SHOULDER)** and **12 (RIGHT_SHOULDER)**.
3. **Torso scale** = Euclidean length of `(shoulder_mid − hip_center)`. A
   missing/non-finite/near-zero torso invalidates the frame.
4. For every landmark `i`:
   `(x', y', z') = (p_i − hip_center) / torso_scale`
   `visibility` is copied unchanged.

Live webcam poses in `/web` **must apply the same transform** before pose comparison, or scores will be silently wrong.

Smoothing (Savitzky–Golay) is applied **before** normalization in the prep pipeline. The game may smooth live poses independently; comparison should still use this normalized space.

Offline tracking requires the torso plus at least six gameplay joints at
visibility ≥ 0.35. Only short bounded gaps (about 100 ms) are interpolated;
long gaps remain invalid and are excluded from smoothing, energy, and hits.
All-zero or low-visibility keyframes are rejected.

Timeline: all `beat_times`, move `start`/`end`, and extracted audio are on the
zero-based video master timeline—the same clock exposed by
`HTMLMediaElement.currentTime`.
