# Dancify song cache (backend)

Tiny **no-auth** API for the hackathon: store songs/clips, cache pipeline `dance.json` (+ audio) so you don’t re-run MediaPipe, and keep per-song play history.

**Stack:** FastAPI + SQLite + files under `backend/data/`.

> Documented in `PRD.md.md` §7 / §8 / §14: local song cache is **in scope**. Still out of scope: user accounts, cloud DB/GPU, OAuth. This service is FastAPI + SQLite + disk files only.

## Run (plug and play)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API: http://127.0.0.1:8000
- Docs: http://127.0.0.1:8000/docs
- DB file: `backend/data/dancify.db`
- Media: `backend/data/songs/<id>/`

Keep this no-auth service bound to localhost. It is a local hackathon companion,
not a LAN or public API. Run one Uvicorn worker; per-song mutation locks are
process-local.

## Cache invariants

`status=ready` means one complete, playable bundle exists:

1. a local reference video,
2. a `dance.json` that passes the frozen JSON schema and semantic checks, and
3. matching extracted audio.

Only a successful `PUT /songs/{id}/chart` promotes a new chart/audio generation.
The request requires both `chart` and `audio`, validates and stages both first,
then atomically promotes the generation. A rejected or failed replacement leaves
the previous ready bundle unchanged.

Every move target must also contain a usable normalized pose: finite landmarks,
at least six gameplay joints at visibility `>= 0.35`, and nonzero visible pose
geometry. All-zero and low-visibility targets are rejected with HTTP 422.

Replacing the reference video, or changing/clearing `source_url`, resets the song
to `pending` and clears its chart, audio, BPM, duration, move count, error, and
processed timestamp. A manual `PATCH status=ready` is rejected unless all three
bundle files already exist.

## Typical flow

1. **Create a song** (upload clip and/or paste a URL):

```bash
curl -s -X POST http://127.0.0.1:8000/songs \
  -F 'title=Demo Solo' \
  -F 'source_url=https://example.com/dance.mp4' \
  -F 'video=@./myclip.mp4'
```

2. If the song was created from a URL, the pipeline first uploads the downloaded
   reference video:

```bash
curl -s -X POST "http://127.0.0.1:8000/songs/<SONG_ID>/video" \
  -F 'video=@./reference.mp4'
```

3. **Pipeline** runs prep, then caches the complete chart/audio bundle:

```bash
curl -s -X PUT "http://127.0.0.1:8000/songs/<SONG_ID>/chart" \
  -F 'chart=@./dance.json' \
  -F 'audio=@./audio.wav'
```

4. **Game** checks `GET /songs/<id>` — when `status=ready`, pull the complete
   reference-video/chart/audio bundle instead of re-running:

```bash
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/video -o reference.mp4
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/chart -o dance.json
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/audio -o audio.wav
```

The reference `<video>` element owns playback and is the sole gameplay clock.
Do not play the audio sidecar independently; it is a bundled derivative for
fallback/export use and must remain aligned to the video timeline.

5. **After a playthrough**, record history:

```bash
curl -s -X POST http://127.0.0.1:8000/songs/<SONG_ID>/plays \
  -H 'Content-Type: application/json' \
  -d '{"player_name":"Noel","score":9800,"accuracy":0.91,"max_combo":42,"judgments":{"PERFECT":10,"SUPER":4,"GOOD":2,"MISS":1}}'
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/songs` | List songs + cache flags |
| POST | `/songs` | Create (multipart: `title`, optional `source_url`, optional `video`) |
| POST | `/songs/json` | Create from JSON (`title` + `source_url`) |
| GET | `/songs/{id}` | Detail |
| PATCH | `/songs/{id}` | Update title/status/metadata |
| DELETE | `/songs/{id}` | Delete song + files |
| POST | `/songs/{id}/video` | Attach/replace video |
| GET | `/songs/{id}/video` | Download video |
| PUT | `/songs/{id}/chart` | Validate and atomically save required `dance.json` + audio → `status=ready` |
| GET | `/songs/{id}/chart` | Fetch cached chart |
| GET | `/songs/{id}/audio` | Fetch cached audio |
| POST | `/songs/{id}/plays` | Record a play |
| GET | `/songs/{id}/plays` | History for that song |
| GET | `/plays` | Recent plays |

**Status values:** `pending` → `processing` → `ready` | `failed`. `ready` is
normally set only by the chart/audio upload endpoint.

Pipeline tip: `PATCH` status to `processing` when you start, `PUT /chart` on success, or `PATCH` `status=failed` + `error_message` on failure.

## Reproducible demo seed (clean checkout)

The mandatory demo is built entirely from the tracked canonical assets:

- `pipeline/testdata/Video_1.mp4`
- `pipeline/testdata/audio_1.m4a`

The seed command muxes the sidecar audio onto the video master timeline, runs
the hardened pipeline with real audio, and uploads the reference video plus
validated chart/audio. Generated mux, chart, report, and WAV files stay in a
temporary directory and are not committed.

From a clean checkout:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install \
  -r backend/requirements.txt -r backend/requirements-dev.txt

python3 -m venv pipeline/.venv
pipeline/.venv/bin/python -m pip install -r pipeline/requirements-dev.txt

# terminal A
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal B, repository root
bash backend/scripts/bake_demo_songs.sh
```

Rerunning the command reuses the same song ID and preserves its play history.
The previous ready bundle remains available while local generation runs and
while a replacement chart/audio generation is staged.

Optional local fixtures `pipeline/testdata/sample_a.mp4` and `sample_b.mp4` are
seeded only when present; otherwise each is reported as an explicit skip.

Atomic, gitignored outputs:

- `backend/data/demo_seed_manifest.json` — stable song identity and URLs
- `backend/data/demo_seed_results.json` — generation, skip, and GET verification

Use `BASE_URL` for a non-default local port. Use `PIPELINE_PYTHON` if the
pipeline environment is not at `pipeline/.venv/bin/python`.

## Env / config

Defaults are safe for a local Vite demo:

- CORS origins: `http://localhost:5173`, `http://127.0.0.1:5173`
- Credentials: disabled
- Maximum video: 500 MiB
- Maximum audio: 100 MiB
- Maximum chart: 20 MiB

`source_url` must be an absolute `http://` or `https://` URL.

Optional environment variables:

- `DANCIFY_DATA_DIR`
- `DANCIFY_CORS_ORIGINS` (comma-separated explicit origins)
- `DANCIFY_MAX_VIDEO_BYTES`
- `DANCIFY_MAX_AUDIO_BYTES`
- `DANCIFY_MAX_CHART_BYTES`

New database rows store media paths relative to `DANCIFY_DATA_DIR`, so the data
directory can be moved or restored. Legacy absolute paths inside that directory
continue to resolve.

## Tests

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
python -m compileall -q app
```

The pytest suite uses an isolated temporary SQLite database and media directory.
`smoke_test.sh` remains the end-to-end check against a running localhost server.
