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

`status=ready` means one complete, playable immutable bundle exists:

1. a browser-compatible MP4 reference video with H.264 video and AAC music,
2. a `dance.json` that passes the frozen JSON schema and semantic checks, and
3. matching extracted audio, and
4. a `dance.report.json` with preparation and publication provenance.

`POST /songs/{id}/preparations` is the preferred frontend flow. It enqueues one
durable SQLite job and a single local worker invokes `pipeline/prepare_song.py`
in a subprocess for either an uploaded video or `source_url`. URL and upload
inputs therefore use the same normalization, pipeline, validation, and
publication path. Duplicate requests return the existing queued/processing job.

Successful publication validates all media with FFprobe, writes the four files
under `bundle-<uuid>/`, and switches `active_bundle_id` in the same database
commit. A rejected or failed replacement leaves the previous ready generation
and its immutable URLs available. Old generations are retained so in-progress
games and their scores continue to refer to the selected bundle.

Every move target must also contain a usable normalized pose: finite landmarks,
at least six gameplay joints at visibility `>= 0.35`, and nonzero visible pose
geometry. All-zero and low-visibility targets are rejected with HTTP 422.

Uploading a new source video or changing `source_url` does not hide an existing
ready generation. It changes only the next preparation input. A manual
`PATCH status=ready` is rejected unless a complete active bundle already exists.

## Typical flow

1. **Create a song** (upload clip and/or paste a URL):

```bash
curl -s -X POST http://127.0.0.1:8000/songs \
  -F 'title=Demo Solo' \
  -F 'source_url=https://example.com/dance.mp4' \
  -F 'video=@./myclip.mp4'
```

2. Start preparation and poll the durable job:

```bash
curl -s -X POST \
  "http://127.0.0.1:8000/songs/<SONG_ID>/preparations"
curl -s \
  "http://127.0.0.1:8000/songs/<SONG_ID>/preparations/<JOB_ID>"
```

The terminal states are `succeeded` and `failed`. Failure `error_code` is one of
`download_failed`, `unsupported_media`, `timing_required`, `tracking_failed`,
`validation_failed`, `internal`, or `interrupted`. Retry a failed attempt with:

```bash
curl -s -X POST \
  "http://127.0.0.1:8000/songs/<SONG_ID>/preparations/<JOB_ID>/retry"
```

3. **Game** checks `GET /songs/<id>`. When `status=ready`, capture its
   `active_bundle_id` and use the immutable generation throughout that play:

```bash
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/bundles/<BUNDLE_ID>/video -o reference.mp4
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/bundles/<BUNDLE_ID>/chart -o dance.json
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/bundles/<BUNDLE_ID>/audio -o audio.wav
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/bundles/<BUNDLE_ID>/report -o dance.report.json
```

The reference `<video>` element owns playback and is the sole gameplay clock.
Do not play the audio sidecar independently; it is a bundled derivative for
fallback/export use and must remain aligned to the video timeline.

4. **After a playthrough**, record history. Send the captured `bundle_id` when
   an older generation remained open during replacement:

```bash
curl -s -X POST http://127.0.0.1:8000/songs/<SONG_ID>/plays \
  -H 'Content-Type: application/json' \
  -d '{"player_name":"Noel","bundle_id":"<BUNDLE_ID>","score":9800,"accuracy":0.91,"max_combo":42,"judgments":{"PERFECT":10,"SUPER":4,"GOOD":2,"MISS":1}}'
```

The legacy/manual cache endpoint remains available for scripts:

```bash
curl -s -X PUT "http://127.0.0.1:8000/songs/<SONG_ID>/chart" \
  -F 'chart=@./dance.json' \
  -F 'audio=@./audio.wav' \
  -F 'report=@./dance.report.json'
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
| POST | `/songs/{id}/video` | Attach/replace the next preparation input |
| POST | `/songs/{id}/preparations` | Queue or deduplicate preparation |
| GET | `/songs/{id}/preparations/{job}` | Poll durable state/stage/error |
| POST | `/songs/{id}/preparations/{job}/retry` | Retry one failed attempt |
| GET | `/songs/{id}/preparations/{job}/report` | Fetch retained success/failure report |
| GET | `/songs/{id}/video` | Download active video |
| PUT | `/songs/{id}/chart` | Manually validate/publish chart + audio + optional report |
| GET | `/songs/{id}/chart` | Fetch cached chart |
| GET | `/songs/{id}/audio` | Fetch cached audio |
| GET | `/songs/{id}/report` | Fetch active pipeline/provenance report |
| GET | `/songs/{id}/bundles/{bundle}/{asset}` | Fetch immutable video/chart/audio/report |
| POST | `/songs/{id}/plays` | Record a play |
| GET | `/songs/{id}/plays` | History for that song |
| GET | `/plays` | Recent plays |

Song status remains `ready` while a replacement job runs. Preparation status is
the authoritative queued/processing/succeeded/failed lifecycle.

## Reproducible demo seed (clean checkout)

The mandatory demo is built entirely from the tracked canonical assets:

- `pipeline/testdata/Video_1.mp4`
- `pipeline/testdata/audio_1.m4a`

The seed command muxes the sidecar audio onto the video master timeline, runs
the hardened pipeline with real audio, and uploads the reference video plus
validated chart/audio. Generated mux, chart, report, and WAV files stay in a
temporary directory and are not committed.

The canonical seed selects `0.0–59.5s`. The remaining source frames are a
Just Dance end card rather than choreography; diagnostics show no dancer
detection from `60.28–62.24s`. Excluding that non-dance outro is an input-range
decision, not threshold relaxation or pose interpolation.

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
- `DANCIFY_MAX_REPORT_BYTES`
- `DANCIFY_MEDIA_DURATION_TOLERANCE` (seconds; default `0.25`, with 2% floor)
- `DANCIFY_PIPELINE_PYTHON` (explicit pipeline interpreter; default
  `pipeline/.venv/bin/python`)
- `DANCIFY_PREPARATION_WORKER_ENABLED=0` (disable the local worker, primarily
  for tests)
- `DANCIFY_PREPARATION_POLL_SECONDS`
- `DANCIFY_PREPARATION_TIMEOUT_SECONDS`
- `DANCIFY_YTDLP_COOKIES_FILE` (absolute path outside the repository)
- `DANCIFY_YTDLP_IMPERSONATE` (for example `chrome`, when supported locally)

New database rows store media paths relative to `DANCIFY_DATA_DIR`, so the data
directory can be moved or restored. Legacy absolute paths inside that directory
continue to resolve.

The worker assumes one backend process and one Uvicorn worker. Do not expose
this unauthenticated API publicly. Vite and the backend run on the same player
machine; configure only explicit localhost CORS origins. Camera access still
requires localhost or HTTPS secure context.

URL authentication is intentionally external to the API. Configure yt-dlp
cookies/configuration in the OS account running the pipeline, or point
`DANCIFY_YTDLP_COOKIES_FILE` at a restricted cookie file. Never place cookies,
tokens, or credentials in `source_url`, source control, request payloads, or
logs. A `download_failed` job directs the user to local upload fallback.

## Tests

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
python -m compileall -q app
```

The pytest suite uses an isolated temporary SQLite database and media directory.
The worker is disabled in tests. `smoke_test.sh` uses FFmpeg-generated valid
media and remains the end-to-end check against a running localhost server.
