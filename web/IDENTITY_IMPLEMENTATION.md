# Player identity: implementation proposal

Status: dependency-free state machine and synthetic tests only. **Not connected
to the camera or scoring.** The current game still requires one person in frame.
This implements part of the plan in `../docs/plans/webcam-player-lock.md`; it does
not pass that plan's multi-person acceptance gate.

## Proposed runtime dependencies

| Pinned package | Purpose | Registry license | Unpacked package size |
| --- | --- | --- | --- |
| `@mediapipe/tasks-vision@1.1.0` | PoseLandmarker configured for multiple bodies; 33 full-image landmarks per candidate | Apache-2.0 | 40.6 MB |
| `@vladmandic/face-api@1.7.15` | Local face detection, landmarks, and 128-value recognition descriptors | MIT | 23.7 MB |

Versions, package licenses and unpacked sizes were checked against npm metadata.
These are package sizes, not browser download estimates. Face API's browser build
bundles TensorFlow.js; select only tiny face detection, face landmarks and face
recognition assets. Do not load age, gender or expression models. Face API is an
older library: compatibility, maintenance and model provenance need checking
before enabling it in the game.

Approval is for adding these packages and the local model assets needed for this
feature. Neither dependency has been installed or added to the lockfile. The
repository requires asking before adding dependencies (`../AGENTS.md.md`).

After approval, inspect the pinned package contents and model redistribution
terms, record model URLs/versions and SHA-256 hashes in the setup script, and
copy only necessary assets to ignored local public directories. Preserve npm
integrity checking. Model download failure must produce a setup error; no silent
runtime CDN fallback. Existing working single-person camera remains available
while the new runtime is validated.

## Integration sequence

1. Add an isolated multi-person runtime, one frozen inference frame at a time.
   Associate a face with a body only when the geometry uniquely supports it.
   Keep face descriptors separate from `PoseSample`, movement logs and React
   snapshots. Benchmark local inference and loading before selecting defaults.
2. Add an explicit pairing action with session-only face-matching explanation.
   Require one body, one uniquely associated usable face, full framing and a fresh
   observation. The controller button or on-screen action confirms enrollment;
   the controller cannot establish who is wearing it.
3. Feed candidates through `src/core/identity/playerLock.ts`. Body continuity
   allows short face occlusion; contradictory face evidence, crossed tracks or
   multiple face matches reject samples. Returning players require fresh face
   evidence and an explicit confirmation before the Ready/countdown flow.
4. Connect identity rejection to immediate reference-video pause and scoring
   epoch invalidation. A null selection must never fall back to candidate zero.
   An identity snapshot is UI state, not permission to score: every sample needs
   a fresh accepted selection. A no-frame watchdog must pause even when inference
   stops emitting; old/generation-mismatched callbacks cannot revive a session.
5. Clear enrollment at round end, exit, replay/new run, re-pair, mode/device
   change, camera stop/error and unmount. Temporary pause invalidates in-flight
   observations and requires re-confirmation before resuming. Drop all runtime
   candidate descriptors alongside the enrollment reference.
6. Verify full-frame landmark normalization against existing fixtures. The new
   task model/runtime is not assumed numerically identical to the Python model.
   Keep reference `video.currentTime` as the score clock; monotonic timestamps
   serve observation freshness only. Keep frozen chart and BLE formats intact.
7. Run browser integration tests, then the physical teammate trials in
   `TEAMMATE_TEST.md`. Enable crowd support only after those gates pass.

## Current code and limits

`PlayerLock` stores its enrollment in private memory, copies incoming descriptors,
and exposes only status/reason/generation. It never changes enrollment implicitly.
Its JSON representation excludes descriptors. Tests cover consent, multiple
people, reordered detections, visible replacement faces, crossings, duplicate
face matches, exit/return confirmation, stale observations and clearing.

Distance, overlap and timing defaults are provisional. Synthetic descriptors
validate decisions, not real recognition accuracy. Bounding-box overlap alone
cannot prove continuity when one body hides another; the runtime must supply
reliable candidate detection and association, and physical occlusion trials may
require a stronger motion tracker or more conservative pausing. This is session
continuity assistance, not authentication or spoof-resistant recognition.

No biometric data may enter localStorage, IndexedDB, network payloads, downloadable
logs, analytics or error messages. Only the existing 12 body joints may enter
movement diagnostics. JavaScript can release references but cannot guarantee
secure memory erasure.
