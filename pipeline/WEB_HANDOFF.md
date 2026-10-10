# Web handoff — loading charts from Person A

Person B owns `/web`. This note is how to consume pipeline output **without** re-running MediaPipe offline.

## 1. Prefer the song-cache API

Backend (no auth): `http://127.0.0.1:8000` by default — see
[`../backend/README.md`](../backend/README.md). Read the base URL from
configuration (for example `VITE_DANCIFY_API_URL`); do not hardcode it in game
logic.

### Create and prepare

Create from a supported HTTP(S) URL with `POST /songs/json`, or upload a local
video with embedded music using multipart `POST /songs`. Then start the same
pipeline for either source:

```http
POST /songs/{id}/preparations
GET  /songs/{id}/preparations/{job_id}
POST /songs/{id}/preparations/{job_id}/retry
```

The start request may include a reviewed playable range:

```json
{
  "source_kind": "url",
  "start_time": 0.0,
  "end_time": 59.5
}
```

The prepared bundle gets a new zero-based timeline. Use range selection to
exclude intros/outros or cuts that are not choreography, not to hide tracking
failure inside a dance segment.

Preparation states are `queued`, `processing`, `succeeded`, and `failed`.
Display `stage`, `error_code`, and `error_message`; never infer the cause from a
generic failed status. In particular:

- `download_failed`: URL access failed; offer local upload.
- `unsupported_media`: upload/download cannot be decoded or lacks intended music.
- `timing_required`: audio has no reliable beat timing.
- `tracking_failed`: footage does not meet the solo tracking contract.
- `validation_failed`: generated output failed a bundle/chart invariant.

One active job per song is allowed. Repeated start requests return the active
job. A replacement job leaves the previous ready bundle playable until the new
generation is atomically published.

### List songs / check cache

```http
GET /songs
GET /songs/{id}
```

When a song is ready:

- `status === "ready"`
- `has_video === true`
- `has_chart === true`
- `has_audio === true`

**Do not** call the prep pipeline from the browser. If `status` is `pending` / `processing`, show a waiting state (or let Person A finish prep).

### Load one immutable gameplay bundle

```http
GET /songs/{id}/bundles/{bundle_id}/video   → reference video (master media)
GET /songs/{id}/bundles/{bundle_id}/chart   → dance.json
GET /songs/{id}/bundles/{bundle_id}/audio   → WAV sidecar
GET /songs/{id}/bundles/{bundle_id}/report  → quality/provenance report
```

Example:

```ts
const base = import.meta.env.VITE_DANCIFY_API_URL ?? "http://127.0.0.1:8000";
const songId = "..."; // from GET /songs

const song = await fetch(`${base}/songs/${songId}`).then((r) => r.json());
if (
  song.status !== "ready" ||
  !song.has_video ||
  !song.has_chart ||
  !song.has_audio
) {
  throw new Error("Playable bundle not ready — run pipeline / wait for cache");
}

const bundleId = song.active_bundle_id;
const bundle = `${base}/songs/${songId}/bundles/${bundleId}`;
const dance: Dance = await fetch(`${bundle}/chart`).then((r) => r.json());
const videoUrl = `${bundle}/video`;
const audioUrl = `${bundle}/audio`; // derivative/fallback asset
const report = await fetch(`${bundle}/report`).then((r) => r.json());
```

`Dance` shape matches frozen [`../schema/type.ts`](../schema/type.ts) (`version`, `bpm`, `beat_times`, `duration`, `moves[]`).

Use `videoUrl` as the source of the visible reference `<video>`. That element
owns playback and the only gameplay clock. Do not start `audioUrl` in a second
media element during gameplay; two independently playing elements can drift.
Keep `bundleId` for the entire play even if the song is regenerated.

### After a playthrough

```http
POST /songs/{id}/plays
Content-Type: application/json

{
  "player_name": "Noel",
  "bundle_id": "<captured bundleId>",
  "score": 9800,
  "accuracy": 0.91,
  "max_combo": 42,
  "judgments": { "PERFECT": 10, "SUPER": 4, "GOOD": 2, "MISS": 1 }
}
```

## 2. Local file fallback (no API)

If developing without the backend:

- Video: the exact reference clip Person A analyzed
- Chart: `pipeline/outputs/dance.json` (or any path Person A hands you)
- Audio: `pipeline/outputs/_work/audio.wav` by default (sidecar — **not** inside the JSON schema)

The master clock is the reference **`HTMLVideoElement.currentTime`**, never
`performance.now()`, `AudioContext`, a separate audio element, or another wall
clock. Extracted audio is normalized to the zero-based video duration.

Local runs also produce `dance.report.json`:

```json
{
  "timing": { "synthetic": false, "source": "audio" },
  "readiness": { "cache_ready_by_default": true, "solo_cfr_mvp": true }
}
```

Synthetic timing requires explicit BPM/downbeat and defaults
`cache_ready_by_default` to `false`; the CLI will not upload it without
`--allow-synthetic-cache`.

## 3. Pose comparison must use the same normalization

See [`NORMALIZATION.md`](NORMALIZATION.md). Summary:

- Hip center = mid(landmarks 23, 24)
- Torso scale = ‖mid(shoulders 11,12) − hip‖
- Compare in that space; return `null` (not `0`) when tracking is lost

Chart `keyframe_landmarks` are already normalized. Live webcam poses must be normalized **identically** before cosine/joint-angle compare.

Offline chart generation currently supports stable **solo CFR** clips only.
Multi-person isolation, angular-energy extraction, and hold merging remain
deferred; do not present unsupported inputs as ready.

## 4. What a good chart looks like

Person A gates on `python debug/velocity.py <clip>` — red snapped hits, orange
source valleys, invalid-tracking shading, and non-overlapping windows.
Schema-valid alone is not enough.

### Shipped checkpoint semantics

- Each `move` is one static checkpoint pose, not continuous choreography.
- The target applies for the entire half-open window `start <= t < end`.
- Judge the checkpoint once using the best valid comparison observed in that
  window.
- `keyframe_landmarks` is one pose. Do not fabricate intermediate poses.
- `is_hold` must currently be `false`; hold scoring is not implemented.
- Tracking loss (`null` comparison) is distinct from a miss and does not become
  a zero similarity.
- The frozen chart has no explicit snapped hit time or source-pose time. Do not
  assume the midpoint is exact after window clipping.

For delayed inference, attach the reference-video timestamp captured with the
camera frame and discard results that arrive after their checkpoint is closed.
Pause creates no judgments. Backward seek/replay starts a new scoring epoch and
resets the judged-checkpoint set; one checkpoint cannot score twice within an
epoch.

## 5. URL and upload preparation

```bash
# URL flow
curl -s -X POST http://127.0.0.1:8000/songs/json \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo Solo","source_url":"https://example.com/demo.mp4"}'
curl -s -X POST http://127.0.0.1:8000/songs/<UUID>/preparations

# Upload fallback: the file must contain its intended music.
curl -s -X POST http://127.0.0.1:8000/songs \
  -F 'title=Uploaded Solo' \
  -F 'video=@/path/to/local-video-with-music.mp4'
curl -s -X POST http://127.0.0.1:8000/songs/<UPLOADED_UUID>/preparations
```

yt-dlp authentication is configured outside the API in the backend OS account.
Never send cookies/tokens in `source_url`. `download_failed` means upload is a
fallback for acquisition only; it does not bypass timing or tracking validation.

## 6. Supported deployment

The supported hackathon topology runs Vite and this unauthenticated API on the
same player computer. `127.0.0.1` in a browser always means that player's
computer. Keep the API bound to loopback and add only the actual Vite origin to
`DANCIFY_CORS_ORIGINS`.

Camera and Web Bluetooth require a secure context: `localhost` is accepted for
development; non-local deployments require HTTPS. A hosted frontend calling an
unrelated developer laptop is not a supported arrangement, and the local
no-auth API must not be exposed publicly.
