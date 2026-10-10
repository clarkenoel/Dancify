"""Local no-auth song, chart, audio, and play-history cache."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .chart_validation import ChartSyntaxError, ChartValidationError, validate_chart
from .db import SessionLocal, get_db, init_db
from .models import Play, Song, utcnow
from .paths import (
    SONGS_DIR,
    ensure_data_dirs,
    resolve_stored_path,
    song_dir,
    stored_path,
)
from .schemas import HealthOut, PlayCreate, PlayOut, SongCreate, SongOut, SongUpdate
from .storage import (
    EmptyUploadError,
    UploadTooLargeError,
    read_upload_limited,
    remove_path,
    safe_suffix,
    stage_upload,
    write_bytes_atomically,
)

logger = logging.getLogger(__name__)

MAX_VIDEO_BYTES = int(os.environ.get("DANCIFY_MAX_VIDEO_BYTES", 500 * 1024 * 1024))
MAX_AUDIO_BYTES = int(os.environ.get("DANCIFY_MAX_AUDIO_BYTES", 100 * 1024 * 1024))
MAX_CHART_BYTES = int(os.environ.get("DANCIFY_MAX_CHART_BYTES", 20 * 1024 * 1024))

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
CORS_ORIGINS = tuple(
    origin.strip()
    for origin in os.environ.get(
        "DANCIFY_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)
    ).split(",")
    if origin.strip()
)

_song_locks: dict[str, asyncio.Lock] = {}


def _lock_for(song_id: str) -> asyncio.Lock:
    return _song_locks.setdefault(song_id, asyncio.Lock())


def _cleanup_tombstones() -> None:
    with SessionLocal() as db:
        for tombstone in SONGS_DIR.glob(".deleted-*"):
            song_id = tombstone.name.removeprefix(".deleted-")[:36]
            try:
                uuid.UUID(song_id)
            except ValueError:
                logger.error("Preserving unrecognized deletion tombstone %s", tombstone)
                continue

            song_exists = db.get(Song, song_id) is not None
            folder = song_dir(song_id, create=False)
            try:
                if song_exists and not folder.exists():
                    os.replace(tombstone, folder)
                    logger.warning("Restored interrupted song deletion for %s", song_id)
                elif not song_exists:
                    remove_path(tombstone)
                else:
                    logger.error(
                        "Preserving conflicting deletion tombstone %s", tombstone
                    )
            except OSError:
                logger.exception("Could not reconcile deletion tombstone %s", tombstone)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_data_dirs()
    init_db()
    _cleanup_tombstones()
    yield


app = FastAPI(
    title="Dancify Song Cache",
    description="Local no-auth store for playable song bundles and play history.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CORS_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)


def _get_song(db: Session, song_id: str) -> Song:
    try:
        uuid.UUID(song_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Song not found") from exc
    song = db.scalar(select(Song).where(Song.id == song_id))
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


def _path_exists(value: str | None) -> bool:
    path = resolve_stored_path(value)
    return bool(path and path.is_file())


def _play_count(db: Session, song_id: str) -> int:
    return int(
        db.scalar(select(func.count(Play.id)).where(Play.song_id == song_id)) or 0
    )


def _song_out(song: Song, play_count: int = 0) -> SongOut:
    return SongOut(
        id=song.id,
        title=song.title,
        source_url=song.source_url,
        status=song.status,
        error_message=song.error_message,
        has_video=_path_exists(song.video_path),
        has_audio=_path_exists(song.audio_path),
        has_chart=_path_exists(song.chart_path),
        bpm=song.bpm,
        duration=song.duration,
        move_count=song.move_count,
        created_at=song.created_at,
        updated_at=song.updated_at,
        processed_at=song.processed_at,
        play_count=play_count,
    )


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


def _ready_bundle_complete(song: Song) -> bool:
    return all(
        _path_exists(value)
        for value in (song.video_path, song.chart_path, song.audio_path)
    )


def _clear_derived(song: Song) -> list[str]:
    old_paths = [value for value in (song.chart_path, song.audio_path) if value]
    song.chart_path = None
    song.audio_path = None
    song.bpm = None
    song.duration = None
    song.move_count = None
    song.processed_at = None
    song.error_message = None
    song.status = "pending"
    return old_paths


def _cleanup_artifacts(song_id: str, values: list[str]) -> None:
    folder = song_dir(song_id, create=False).resolve()
    targets: set[Path] = set()
    for value in values:
        path = resolve_stored_path(value)
        if path is None:
            continue
        try:
            path.relative_to(folder)
        except ValueError:
            continue
        if path.parent.parent == folder and path.parent.name.startswith("bundle-"):
            targets.add(path.parent)
        else:
            targets.add(path)
    for target in targets:
        try:
            remove_path(target)
        except OSError:
            logger.exception("Could not remove replaced artifact %s", target)


def _upload_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, UploadTooLargeError):
        return HTTPException(status_code=413, detail=str(exc))
    if isinstance(exc, EmptyUploadError):
        return HTTPException(status_code=400, detail=str(exc))
    logger.exception("Media upload failed")
    return HTTPException(status_code=500, detail="Could not store uploaded media")


async def _promote_video(upload: UploadFile, folder: Path) -> Path:
    suffix = safe_suffix(upload.filename, ".mp4")
    staged = await stage_upload(
        upload,
        folder,
        prefix="video",
        suffix=suffix,
        max_bytes=MAX_VIDEO_BYTES,
    )
    destination = folder / f"video-{uuid.uuid4().hex}{suffix}"
    try:
        os.replace(staged, destination)
    except Exception:
        staged.unlink(missing_ok=True)
        raise
    return destination


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut(ok=True, service="dancify-song-cache", db="sqlite")


@app.get("/songs", response_model=list[SongOut])
def list_songs(db: Session = Depends(get_db)) -> list[SongOut]:
    songs = db.scalars(select(Song).order_by(Song.created_at.desc())).all()
    counts = dict(
        db.execute(
            select(Play.song_id, func.count(Play.id)).group_by(Play.song_id)
        ).all()
    )
    return [_song_out(song, int(counts.get(song.id, 0))) for song in songs]


@app.post("/songs", response_model=SongOut, status_code=201)
async def create_song(
    title: str = Form(..., min_length=1, max_length=256),
    source_url: str | None = Form(None, min_length=1, max_length=1024),
    video: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> SongOut:
    try:
        normalized = SongCreate(title=title, source_url=source_url)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    if video is None and normalized.source_url is None:
        raise HTTPException(
            status_code=400,
            detail="Provide a reference video and/or source_url",
        )

    song_id = str(uuid.uuid4())
    folder = song_dir(song_id)
    video_destination: Path | None = None
    try:
        if video is not None:
            video_destination = await _promote_video(video, folder)
    except (UploadTooLargeError, EmptyUploadError, OSError) as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise _upload_http_error(exc) from exc

    song = Song(
        id=song_id,
        title=normalized.title,
        source_url=normalized.source_url,
        status="pending",
        video_path=stored_path(video_destination) if video_destination else None,
    )
    db.add(song)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        shutil.rmtree(folder, ignore_errors=True)
        logger.exception("Could not create song")
        raise HTTPException(status_code=500, detail="Could not create song") from exc
    db.refresh(song)
    return _song_out(song)


@app.post("/songs/json", response_model=SongOut, status_code=201)
def create_song_json(body: SongCreate, db: Session = Depends(get_db)) -> SongOut:
    """Create URL metadata; upload the downloaded reference video separately."""
    if body.source_url is None:
        raise HTTPException(status_code=400, detail="source_url required for JSON create")
    song = Song(
        id=str(uuid.uuid4()),
        title=body.title,
        source_url=body.source_url,
        status="pending",
    )
    db.add(song)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Could not create song")
        raise HTTPException(status_code=500, detail="Could not create song") from exc
    db.refresh(song)
    return _song_out(song)


@app.get("/songs/{song_id}", response_model=SongOut)
def get_song(song_id: str, db: Session = Depends(get_db)) -> SongOut:
    song = _get_song(db, song_id)
    return _song_out(song, _play_count(db, song.id))


@app.patch("/songs/{song_id}", response_model=SongOut)
async def update_song(
    song_id: str, body: SongUpdate, db: Session = Depends(get_db)
) -> SongOut:
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        data = body.model_dump(exclude_unset=True)
        cleanup: list[str] = []

        source_changed = "source_url" in data and data["source_url"] != song.source_url
        if source_changed:
            if "status" in data and data["status"] != "pending":
                raise HTTPException(
                    status_code=409,
                    detail="Changing source_url requires status=pending",
                )
            if song.video_path:
                cleanup.append(song.video_path)
            cleanup.extend(_clear_derived(song))
            song.video_path = None

        if "title" in data:
            song.title = data["title"]
        if "source_url" in data:
            song.source_url = data["source_url"]
        if "error_message" in data and not source_changed:
            song.error_message = data["error_message"]
        if "status" in data and not source_changed:
            if data["status"] == "ready":
                if song.status != "ready":
                    raise HTTPException(
                        status_code=409,
                        detail="Only chart/audio upload can transition to ready",
                    )
                if not _ready_bundle_complete(song):
                    raise HTTPException(
                        status_code=409,
                        detail="ready requires reference video, valid chart, and audio",
                    )
            song.status = data["status"]
            if song.status == "ready":
                song.error_message = None

        song.updated_at = utcnow()
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception("Could not update song")
            raise HTTPException(status_code=500, detail="Could not update song") from exc
        db.refresh(song)
        _cleanup_artifacts(song_id, cleanup)
        return _song_out(song, _play_count(db, song.id))


@app.delete("/songs/{song_id}", status_code=204)
async def delete_song(song_id: str, db: Session = Depends(get_db)) -> Response:
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        folder = song_dir(song_id, create=False)
        tombstone = SONGS_DIR / f".deleted-{song_id}-{uuid.uuid4().hex}"
        moved = False
        try:
            if folder.exists():
                os.replace(folder, tombstone)
                moved = True
            db.delete(song)
            db.commit()
        except Exception as exc:
            db.rollback()
            if moved and tombstone.exists():
                os.replace(tombstone, folder)
            logger.exception("Could not delete song")
            raise HTTPException(status_code=500, detail="Could not delete song") from exc

        if moved:
            try:
                remove_path(tombstone)
            except OSError:
                logger.exception(
                    "Song deleted; file cleanup will retry at startup: %s", tombstone
                )
        _song_locks.pop(song_id, None)
        return Response(status_code=204)


@app.post("/songs/{song_id}/video", response_model=SongOut)
async def upload_video(
    song_id: str,
    video: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> SongOut:
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        folder = song_dir(song_id)
        try:
            destination = await _promote_video(video, folder)
        except (UploadTooLargeError, EmptyUploadError, OSError) as exc:
            raise _upload_http_error(exc) from exc

        cleanup = [
            value
            for value in (song.video_path, song.chart_path, song.audio_path)
            if value
        ]
        song.video_path = stored_path(destination)
        _clear_derived(song)
        song.updated_at = utcnow()
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            destination.unlink(missing_ok=True)
            logger.exception("Could not replace reference video")
            raise HTTPException(
                status_code=500, detail="Could not replace reference video"
            ) from exc
        db.refresh(song)
        _cleanup_artifacts(song_id, cleanup)
        return _song_out(song, _play_count(db, song.id))


@app.get("/songs/{song_id}/video")
def download_video(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    path = resolve_stored_path(song.video_path)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="No reference video on file")
    return FileResponse(path, filename=f"video{path.suffix}")


@app.put("/songs/{song_id}/chart", response_model=SongOut)
async def upload_chart(
    song_id: str,
    chart: UploadFile = File(..., description="dance.json from the pipeline"),
    audio: UploadFile = File(..., description="audio matching the chart"),
    db: Session = Depends(get_db),
) -> SongOut:
    """Atomically promote one validated chart/audio generation."""
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        if not _path_exists(song.video_path):
            raise HTTPException(
                status_code=409,
                detail="Upload the reference video before the chart/audio bundle",
            )

        try:
            raw_chart = await read_upload_limited(chart, MAX_CHART_BYTES)
            payload = validate_chart(raw_chart)
        except UploadTooLargeError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (EmptyUploadError, ChartSyntaxError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid chart: {exc}") from exc
        except ChartValidationError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid chart: {exc}") from exc

        folder = song_dir(song_id)
        generation = uuid.uuid4().hex
        staged_bundle = folder / f".bundle-{generation}.tmp"
        final_bundle = folder / f"bundle-{generation}"
        staged_bundle.mkdir()
        audio_suffix = safe_suffix(audio.filename, ".wav")
        try:
            await write_bytes_atomically(raw_chart, staged_bundle / "dance.json")
            staged_audio = await stage_upload(
                audio,
                staged_bundle,
                prefix="audio",
                suffix=audio_suffix,
                max_bytes=MAX_AUDIO_BYTES,
            )
            os.replace(staged_audio, staged_bundle / f"audio{audio_suffix}")
            os.replace(staged_bundle, final_bundle)
        except (UploadTooLargeError, EmptyUploadError, OSError) as exc:
            shutil.rmtree(staged_bundle, ignore_errors=True)
            shutil.rmtree(final_bundle, ignore_errors=True)
            raise _upload_http_error(exc) from exc

        chart_destination = final_bundle / "dance.json"
        audio_destination = final_bundle / f"audio{audio_suffix}"
        old_bundle = [
            value for value in (song.chart_path, song.audio_path) if value
        ]
        song.chart_path = stored_path(chart_destination)
        song.audio_path = stored_path(audio_destination)
        song.bpm = float(payload["bpm"])
        song.duration = float(payload["duration"])
        song.move_count = len(payload["moves"])
        song.status = "ready"
        song.error_message = None
        song.processed_at = utcnow()
        song.updated_at = utcnow()
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            shutil.rmtree(final_bundle, ignore_errors=True)
            logger.exception("Could not commit chart/audio bundle")
            raise HTTPException(
                status_code=500, detail="Could not commit chart/audio bundle"
            ) from exc
        db.refresh(song)
        _cleanup_artifacts(song_id, old_bundle)
        return _song_out(song, _play_count(db, song.id))


def _ready_file(song: Song, value: str | None, label: str) -> Path:
    path = resolve_stored_path(value)
    if song.status != "ready" or path is None or not path.is_file():
        raise HTTPException(status_code=404, detail=f"{label} not ready")
    return path


@app.get("/songs/{song_id}/chart")
def get_chart(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    path = _ready_file(song, song.chart_path, "Chart")
    return FileResponse(path, media_type="application/json", filename="dance.json")


@app.get("/songs/{song_id}/audio")
def get_audio(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    path = _ready_file(song, song.audio_path, "Audio")
    return FileResponse(path, filename=f"audio{path.suffix}")


@app.post("/songs/{song_id}/plays", response_model=PlayOut, status_code=201)
def record_play(
    song_id: str, body: PlayCreate, db: Session = Depends(get_db)
) -> PlayOut:
    _get_song(db, song_id)
    play = Play(
        id=str(uuid.uuid4()),
        song_id=song_id,
        player_name=body.player_name,
        score=body.score,
        accuracy=body.accuracy,
        max_combo=body.max_combo,
        judgments_json=json.dumps(body.judgments) if body.judgments is not None else None,
        notes=body.notes,
    )
    db.add(play)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Song was deleted before play could be recorded"
        ) from exc
    db.refresh(play)
    return _play_out(play)


@app.get("/songs/{song_id}/plays", response_model=list[PlayOut])
def list_plays_for_song(song_id: str, db: Session = Depends(get_db)) -> list[PlayOut]:
    _get_song(db, song_id)
    plays = db.scalars(
        select(Play).where(Play.song_id == song_id).order_by(Play.played_at.desc())
    ).all()
    return [_play_out(play) for play in plays]


@app.get("/plays", response_model=list[PlayOut])
def list_recent_plays(limit: int = 50, db: Session = Depends(get_db)) -> list[PlayOut]:
    limit = max(1, min(limit, 200))
    plays = db.scalars(select(Play).order_by(Play.played_at.desc()).limit(limit)).all()
    return [_play_out(play) for play in plays]
