# Landmark normalization handshake (Person A ↔ Person B)

Also read [`WEB_HANDOFF.md`](WEB_HANDOFF.md) for how to load cached charts from the song-cache API.

Chart `keyframe_landmarks` are **not** raw MediaPipe image coordinates.

For each frame / keyframe:

1. **Hip center** = midpoint of MediaPipe landmarks **23 (LEFT_HIP)** and **24 (RIGHT_HIP)** in `(x, y, z)`.
2. **Shoulder midpoint** = midpoint of **11 (LEFT_SHOULDER)** and **12 (RIGHT_SHOULDER)**.
3. **Torso scale** = Euclidean length of `(shoulder_mid − hip_center)`. If near-zero, treat as `1.0`.
4. For every landmark `i`:  
   `(x', y', z') = (p_i − hip_center) / torso_scale`  
   `visibility` is copied unchanged.

Live webcam poses in `/web` **must apply the same transform** before pose comparison, or scores will be silently wrong.

Smoothing (Savitzky–Golay) is applied **before** normalization in the prep pipeline. The game may smooth live poses independently; comparison should still use this normalized space.

Timeline: all `beat_times`, move `start`/`end`, and extracted audio are on the **video container timeline** (`t = 0` at start of file) — the same clock as `video.currentTime`.
