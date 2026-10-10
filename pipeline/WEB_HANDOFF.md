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
- `has_audio === true` (usually)

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
if (song.status !== "ready" || !song.has_chart) {
  throw new Error("Chart not ready — run pipeline / wait for cache");
}

const dance: Dance = await fetch(`${base}/songs/${songId}/chart`).then((r) =>
  r.json(),
);
const audioUrl = `${base}/songs/${songId}/audio`; // use as <audio>/<video> src or Web Audio
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

Master clock is still **`video.currentTime`** of the reference clip / audio element, not `performance.now()`.

## 3. Pose comparison must use the same normalization

See [`NORMALIZATION.md`](NORMALIZATION.md). Summary:

- Hip center = mid(landmarks 23, 24)
- Torso scale = ‖mid(shoulders 11,12) − hip‖
- Compare in that space; return `null` (not `0`) when tracking is lost

Chart `keyframe_landmarks` are already normalized. Live webcam poses must be normalized **identically** before cosine/joint-angle compare.

## 4. What a good chart looks like

Person A gates on `python debug/velocity.py <clip>` — red hits on the beat grid at ~**every 2 beats**, non-overlapping move windows. Schema-valid alone is not enough.

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
