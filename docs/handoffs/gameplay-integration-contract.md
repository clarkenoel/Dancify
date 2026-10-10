# Gameplay Integration Contract

**Owners:** pipeline/backend ↔ web  
**Frozen schema:** unchanged (`version: "1.0"`)

## Bundle selection

1. Poll the preparation job until `succeeded`.
2. Read the song's `active_bundle_id`.
3. Load video, chart, audio, and report from immutable
   `/songs/{song_id}/bundles/{bundle_id}/{asset}` URLs.
4. Keep that bundle ID for the full play and include it in `POST /plays`.

A replacement may publish a newer active bundle, but it cannot change the
assets selected by a game already in progress.

## Checkpoint model

- One move is one static target pose over `start <= t < end`.
- `keyframe_landmarks` is not a choreography sequence.
- Current moves are not holds; `is_hold=true` is rejected.
- The web game samples player poses during the window and emits one judgment
  from the best valid comparison.
- No valid comparison means tracking lost, not a miss or score of zero.
- Window midpoint is not guaranteed to be the original snapped musical hit.

## Clock and inference

- The reference `<video>.currentTime` is the only gameplay clock.
- Capture that timestamp with each webcam frame.
- Discard delayed inference after the checkpoint window/epoch has closed.
- Pause produces no judgments.
- Backward seek and replay create a new scoring epoch and reset judged moves.
- A move can be judged once per epoch.

## Pose compatibility

Use `pipeline/fixtures/pose-normalization.json` and
`pipeline/NORMALIZATION.md`. Return tracking lost when torso geometry is
missing, non-finite, or near zero, or fewer than six gameplay joints meet
visibility `0.35`.

## Preparation failures

| Code | Web action |
|---|---|
| `download_failed` | Explain the source could not be fetched; offer local upload |
| `unsupported_media` | Ask for browser-decodable video containing intended music |
| `timing_required` | Ask for audible music or reviewed timing input |
| `tracking_failed` | Show tracking diagnostic/report; ask for cleaner solo footage |
| `validation_failed` | Do not play; report generated-output incompatibility |
| `interrupted` / `internal` | Offer retry and retain an older ready bundle |

Local upload changes acquisition only; it does not bypass timing, pose, or
bundle validation.

## Deployment

The supported MVP runs Vite and the loopback-only API on the same player
computer. Configure the frontend API base URL and explicit CORS origin. Camera
and Web Bluetooth require localhost or HTTPS. Do not expose the unauthenticated
backend publicly.
