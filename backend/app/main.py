"""Dancify song cache API.

Plug-and-play local store for clips, cached pipeline charts, and play history.
No auth. SQLite + files on disk.

Run from repo root:
  cd backend && python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import aiofiles
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .db import get_db, init_db
from .models import Play, Song, utcnow
from .paths import ensure_data_dirs, song_dir
from .schemas import (
    HealthOut,
    PlayCreate,
    PlayOut,
    SongCreate,
    SongOut,
    SongUpdate,
)

ALLOWED_STATUS = {"pending", "processing", "ready", "failed"}

app = FastAPI(
    title="Dancify Song Cache",
    description="Simple no-auth store for songs, pipeline charts, and play history.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    ensure_data_dirs()
    init_db()


def _song_out(song: Song) -> SongOut:
    return SongOut(
        id=song.id,
        title=song.title,
        source_url=song.source_url,
        status=song.status,
        error_message=song.error_message,
        has_video=bool(song.video_path and Path(song.video_path).is_file()),
        has_audio=bool(song.audio_path and Path(song.audio_path).is_file()),
        has_chart=bool(song.chart_path and Path(song.chart_path).is_file()),
        bpm=song.bpm,
        duration=song.duration,
        move_count=song.move_count,
        created_at=song.created_at,
        updated_at=song.updated_at,
        processed_at=song.processed_at,
        play_count=len(song.plays) if song.plays is not None else 0,
    )


def _get_song(db: Session, song_id: str, *, load_plays: bool = False) -> Song:
    stmt = select(Song).where(Song.id == song_id)
    if load_plays:
        stmt = stmt.options(selectinload(Song.plays))
    song = db.scalar(stmt)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


def _play_out(play: Play) -> PlayOut:
    judgments = None
    if play.judgments_json:
        try:
            judgments = json.loads(play.judgments_json)
        except json.JSONDecodeError:
            judgments = None
    return PlayOut(
        id=play.id,
        song_id=play.song_id,
        player_name=play.player_name,
        score=play.score,
        accuracy=play.accuracy,
        max_combo=play.max_combo,
        judgments=judgments,
        notes=play.notes,
        played_at=play.played_at,
    )


async def _save_upload(upload: UploadFile, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(dest, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            await out.write(chunk)


def _apply_chart_metadata(song: Song, chart: dict[str, Any]) -> None:
    if "bpm" in chart:
        song.bpm = float(chart["bpm"])
    if "duration" in chart:
        song.duration = float(chart["duration"])
    moves = chart.get("moves")
    if isinstance(moves, list):
        song.move_count = len(moves)


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(ok=True, service="dancify-song-cache", db="sqlite")


@app.get("/songs", response_model=list[SongOut])
def list_songs(db: Session = Depends(get_db)) -> list[SongOut]:
    songs = db.scalars(
        select(Song).options(selectinload(Song.plays)).order_by(Song.created_at.desc())
    ).all()
    return [_song_out(s) for s in songs]


@app.post("/songs", response_model=SongOut, status_code=201)
async def create_song(
    title: str = Form(...),
    source_url: str | None = Form(None),
    video: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> SongOut:
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if video is None and not (source_url and source_url.strip()):
        raise HTTPException(
            status_code=400,
            detail="Provide a video file and/or source_url",
        )

    song_id = str(uuid.uuid4())
    folder = song_dir(song_id)
    video_path = None
    if video is not None and video.filename:
        suffix = Path(video.filename).suffix or ".mp4"
        dest = folder / f"video{suffix}"
        await _save_upload(video, dest)
        video_path = str(dest)

    song = Song(
        id=song_id,
        title=title.strip(),
        source_url=source_url.strip() if source_url else None,
        status="pending",
        video_path=video_path,
    )
    db.add(song)
    db.commit()
    db.refresh(song)
    song.plays = []
    return _song_out(song)


@app.post("/songs/json", response_model=SongOut, status_code=201)
def create_song_json(body: SongCreate, db: Session = Depends(get_db)) -> SongOut:
    """JSON-only create (URL metadata, upload video later)."""
    if not body.source_url:
        raise HTTPException(status_code=400, detail="source_url required for JSON create")
    song = Song(
        id=str(uuid.uuid4()),
        title=body.title.strip(),
        source_url=body.source_url.strip(),
        status="pending",
    )
    db.add(song)
    db.commit()
    db.refresh(song)
    song.plays = []
    return _song_out(song)


@app.get("/songs/{song_id}", response_model=SongOut)
def get_song(song_id: str, db: Session = Depends(get_db)) -> SongOut:
    return _song_out(_get_song(db, song_id, load_plays=True))


@app.patch("/songs/{song_id}", response_model=SongOut)
def update_song(
    song_id: str, body: SongUpdate, db: Session = Depends(get_db)
) -> SongOut:
    song = _get_song(db, song_id, load_plays=True)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        if data["status"] not in ALLOWED_STATUS:
            raise HTTPException(
                status_code=400,
                detail=f"status must be one of {sorted(ALLOWED_STATUS)}",
            )
    for key, value in data.items():
        setattr(song, key, value)
    song.updated_at = utcnow()
    db.commit()
    db.refresh(song)
    return _song_out(song)


@app.delete("/songs/{song_id}", status_code=204)
def delete_song(song_id: str, db: Session = Depends(get_db)) -> Response:
    song = _get_song(db, song_id)
    folder = song_dir(song_id)
    db.delete(song)
    db.commit()
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    return Response(status_code=204)


@app.post("/songs/{song_id}/video", response_model=SongOut)
async def upload_video(
    song_id: str,
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SongOut:
    song = _get_song(db, song_id, load_plays=True)
    suffix = Path(video.filename or "video.mp4").suffix or ".mp4"
    dest = song_dir(song_id) / f"video{suffix}"
    await _save_upload(video, dest)
    song.video_path = str(dest)
    song.updated_at = utcnow()
    db.commit()
    db.refresh(song)
    return _song_out(song)


@app.get("/songs/{song_id}/video")
def download_video(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    if not song.video_path or not Path(song.video_path).is_file():
        raise HTTPException(status_code=404, detail="No video on file")
    return FileResponse(song.video_path, filename=Path(song.video_path).name)


@app.put("/songs/{song_id}/chart", response_model=SongOut)
async def upload_chart(
    song_id: str,
    chart: UploadFile = File(..., description="dance.json from the pipeline"),
    audio: UploadFile | None = File(None, description="extracted audio, optional"),
    db: Session = Depends(get_db),
) -> SongOut:
    """Cache pipeline output so re-runs are free."""
    song = _get_song(db, song_id, load_plays=True)
    folder = song_dir(song_id)

    chart_dest = folder / "dance.json"
    raw = await chart.read()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON chart: {exc}") from exc

    async with aiofiles.open(chart_dest, "wb") as out:
        await out.write(raw)
    song.chart_path = str(chart_dest)
    _apply_chart_metadata(song, payload)

    if audio is not None and audio.filename:
        suffix = Path(audio.filename).suffix or ".wav"
        audio_dest = folder / f"audio{suffix}"
        await _save_upload(audio, audio_dest)
        song.audio_path = str(audio_dest)

    song.status = "ready"
    song.error_message = None
    song.processed_at = utcnow()
    song.updated_at = utcnow()
    db.commit()
    db.refresh(song)
    return _song_out(song)


@app.get("/songs/{song_id}/chart")
def get_chart(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    if song.status != "ready" or not song.chart_path or not Path(song.chart_path).is_file():
        raise HTTPException(
            status_code=404,
            detail="Chart not ready — run the pipeline and PUT /songs/{id}/chart",
        )
    return FileResponse(
        song.chart_path,
        media_type="application/json",
        filename="dance.json",
    )


@app.get("/songs/{song_id}/audio")
def get_audio(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    if not song.audio_path or not Path(song.audio_path).is_file():
        raise HTTPException(status_code=404, detail="No audio on file")
    return FileResponse(song.audio_path, filename=Path(song.audio_path).name)


@app.post("/songs/{song_id}/plays", response_model=PlayOut, status_code=201)
def record_play(
    song_id: str, body: PlayCreate, db: Session = Depends(get_db)
) -> PlayOut:
    _get_song(db, song_id)
    play = Play(
        id=str(uuid.uuid4()),
        song_id=song_id,
        player_name=(body.player_name or "anonymous").strip() or "anonymous",
        score=body.score,
        accuracy=body.accuracy,
        max_combo=body.max_combo,
        judgments_json=json.dumps(body.judgments) if body.judgments is not None else None,
        notes=body.notes,
    )
    db.add(play)
    db.commit()
    db.refresh(play)
    return _play_out(play)


@app.get("/songs/{song_id}/plays", response_model=list[PlayOut])
def list_plays_for_song(song_id: str, db: Session = Depends(get_db)) -> list[PlayOut]:
    _get_song(db, song_id)
    plays = db.scalars(
        select(Play).where(Play.song_id == song_id).order_by(Play.played_at.desc())
    ).all()
    return [_play_out(p) for p in plays]


@app.get("/plays", response_model=list[PlayOut])
def list_recent_plays(limit: int = 50, db: Session = Depends(get_db)) -> list[PlayOut]:
    limit = max(1, min(limit, 200))
    plays = db.scalars(select(Play).order_by(Play.played_at.desc()).limit(limit)).all()
    return [_play_out(p) for p in plays]
