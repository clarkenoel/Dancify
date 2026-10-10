# Web handoff — loading charts from Person A

Person B owns `/web`. This note is how to consume pipeline output **without** re-running MediaPipe offline.

## 1. Prefer the song-cache API

Backend (no auth): `http://127.0.0.1:8000` — see [`../backend/README.md`](../backend/README.md).

### List songs / check cache

```http
GET /songs
GET /songs/{id}
```

When a song is ready:

- `status === "ready"`
- `has_chart === true`
- `has_audio === true` for gameplay

**Do not** call the prep pipeline from the browser. If `status` is `pending` / `processing`, show a waiting state (or let Person A finish prep).

### Load chart + audio for gameplay

```http
GET /songs/{id}/chart   → dance.json  (application/json)
GET /songs/{id}/audio   → WAV/MP3 sidecar
```

Example:

```ts
const base = "http://127.0.0.1:8000";
const songId = "..."; // from GET /songs

const song = await fetch(`${base}/songs/${songId}`).then((r) => r.json());
if (song.status !== "ready" || !song.has_chart || !song.has_audio) {
  throw new Error("Chart not ready — run pipeline / wait for cache");
}

const dance: Dance = await fetch(`${base}/songs/${songId}/chart`).then((r) =>
  r.json(),
);
const audioUrl = `${base}/songs/${songId}/audio`; // use as the media element source
```

`Dance` shape matches frozen [`../schema/type.ts`](../schema/type.ts) (`version`, `bpm`, `beat_times`, `duration`, `moves[]`).

### After a playthrough

```http
POST /songs/{id}/plays
Content-Type: application/json

{
  "player_name": "Noel",
  "score": 9800,
  "accuracy": 0.91,
  "max_combo": 42,
  "judgments": { "PERFECT": 10, "SUPER": 4, "GOOD": 2, "MISS": 1 }
}
```

## 2. Local file fallback (no API)

If developing without the backend:

- Chart: `pipeline/outputs/dance.json` (or any path Person A hands you)
- Audio: `pipeline/outputs/audio.wav` (sidecar — **not** inside the JSON schema)

The master clock is **`HTMLMediaElement.currentTime`** on the element that owns
playback (`<video>` or `<audio>`), never `performance.now()` or a separate wall
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

## 5. Creating a song + caching (Person A side)

```bash
# API up: cd backend && uvicorn app.main:app --port 8000
curl -s -X POST http://127.0.0.1:8000/songs/json \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo Solo","source_url":"local:sample"}'

cd pipeline
python main.py --input testdata/sample.mp4 --output outputs/dance.json --song-id <UUID>
```

Web then only needs `GET /songs/<UUID>/chart` + `/audio`.
