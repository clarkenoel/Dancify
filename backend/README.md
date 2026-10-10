# Dancify song cache (backend)

Tiny **no-auth** API for the hackathon: store songs/clips, cache pipeline `dance.json` (+ audio) so you don’t re-run MediaPipe, and keep per-song play history.

**Stack:** FastAPI + SQLite + files under `backend/data/`.

> Documented in `PRD.md` §7 / §8 / §14: local song cache is **in scope**. Still out of scope: user accounts, cloud DB/GPU, OAuth. This service is FastAPI + SQLite + disk files only.

## Run (plug and play)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API: http://127.0.0.1:8000  
- Docs: http://127.0.0.1:8000/docs  
- DB file: `backend/data/dancify.db`  
- Media: `backend/data/songs/<id>/`

## Typical flow

1. **Create a song** (upload clip and/or paste a URL):

```bash
curl -s -X POST http://127.0.0.1:8000/songs \
  -F 'title=Demo Solo' \
  -F 'source_url=https://example.com/dance.mp4' \
  -F 'video=@./myclip.mp4'
```

2. **Pipeline** downloads/reads the video, runs prep, then **caches** the chart:

```bash
curl -s -X PUT "http://127.0.0.1:8000/songs/<SONG_ID>/chart" \
  -F 'chart=@./dance.json' \
  -F 'audio=@./audio.wav'
```

3. **Game** checks `GET /songs/<id>` — if `has_chart` / `status=ready`, pull chart instead of re-running:

```bash
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/chart -o dance.json
curl -s http://127.0.0.1:8000/songs/<SONG_ID>/audio -o audio.wav
```

4. **After a playthrough**, record history:

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
| PUT | `/songs/{id}/chart` | Save pipeline `dance.json` (+ optional audio) → `status=ready` |
| GET | `/songs/{id}/chart` | Fetch cached chart |
| GET | `/songs/{id}/audio` | Fetch cached audio |
| POST | `/songs/{id}/plays` | Record a play |
| GET | `/songs/{id}/plays` | History for that song |
| GET | `/plays` | Recent plays |

**Status values:** `pending` → `processing` → `ready` | `failed`

Pipeline tip: `PATCH` status to `processing` when you start, `PUT /chart` on success, or `PATCH` `status=failed` + `error_message` on failure.

## Env / config

None required. Optional later: point `DATA_DIR` elsewhere by editing `app/paths.py`. CORS is open (`*`) for local web.
