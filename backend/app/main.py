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

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .bundles import ReportValidationError, bundle_asset_path, publish_bundle
from .chart_validation import ChartSyntaxError, ChartValidationError, validate_chart
from .db import SessionLocal, get_db, init_db
from .media import MediaValidationError
from .models import Play, PreparationJob, Song, utcnow
from .paths import (
    SONGS_DIR,
    ensure_data_dirs,
    resolve_stored_path,
    song_dir,
    stored_path,
)
from .preparation import PreparationWorker, worker_enabled
from .schemas import (
    HealthOut,
    PlayCreate,
    PlayOut,
    PreparationCreate,
    PreparationOut,
    SongCreate,
    SongOut,
    SongUpdate,
)
from .storage import (
    EmptyUploadError,
    UploadTooLargeError,
    read_upload_limited,
    remove_path,
    safe_suffix,
    stage_upload,
)

logger = logging.getLogger(__name__)

MAX_VIDEO_BYTES = int(os.environ.get("DANCIFY_MAX_VIDEO_BYTES", 500 * 1024 * 1024))
MAX_AUDIO_BYTES = int(os.environ.get("DANCIFY_MAX_AUDIO_BYTES", 100 * 1024 * 1024))
MAX_CHART_BYTES = int(os.environ.get("DANCIFY_MAX_CHART_BYTES", 20 * 1024 * 1024))
MAX_REPORT_BYTES = int(os.environ.get("DANCIFY_MAX_REPORT_BYTES", 20 * 1024 * 1024))

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
async def lifespan(application: FastAPI):
    ensure_data_dirs()
    init_db()
    _cleanup_tombstones()
    worker: PreparationWorker | None = None
    if worker_enabled():
        worker = PreparationWorker()
        await worker.start()
    application.state.preparation_worker = worker
    try:
        yield
    finally:
        if worker is not None:
            await worker.stop()


app = FastAPI(
    title="Dancify Song Cache",
    description="Local no-auth store for playable song bundles and play history.",
    version="0.3.0",
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


def _active_preparation(db: Session, song_id: str) -> PreparationJob | None:
    return db.scalar(
        select(PreparationJob).where(
            PreparationJob.song_id == song_id,
            PreparationJob.status.in_(("queued", "processing")),
        )
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
        has_report=_path_exists(song.report_path),
        active_bundle_id=song.active_bundle_id,
        active_preparation_job_id=song.active_preparation_job_id,
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
        bundle_id=play.bundle_id,
        player_name=play.player_name,
        score=play.score,
        accuracy=play.accuracy,
        max_combo=play.max_combo,
        judgments=judgments,
        notes=play.notes,
        played_at=play.played_at,
    )


def _preparation_out(job: PreparationJob) -> PreparationOut:
    return PreparationOut(
        id=job.id,
        song_id=job.song_id,
        status=job.status,  # type: ignore[arg-type]
        stage=job.stage,
        error_code=job.error_code,  # type: ignore[arg-type]
        error_message=job.error_message,
        attempt=job.attempt,
        source_kind=job.source_kind,  # type: ignore[arg-type]
        retried_from_id=job.retried_from_id,
        start_time=job.start_time,
        end_time=job.end_time,
        result_bundle_id=job.result_bundle_id,
        has_report=_path_exists(job.report_path),
        has_diagnostic=_path_exists(job.diagnostic_path),
        has_diagnostic_video=_path_exists(job.diagnostic_video_path),
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def _ready_bundle_complete(song: Song) -> bool:
    return all(
        _path_exists(value)
        for value in (
            song.video_path,
            song.chart_path,
            song.audio_path,
            song.report_path,
        )
    ) and bool(song.active_bundle_id)


def _clear_derived(song: Song) -> list[str]:
    old_paths = [
        value
        for value in (
            song.chart_path,
            song.audio_path,
            song.report_path,
        )
        if value
    ]
    song.chart_path = None
    song.audio_path = None
    song.report_path = None
    song.active_bundle_id = None
    song.active_preparation_job_id = None
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
        source_video_path=stored_path(video_destination) if video_destination else None,
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
            if _active_preparation(db, song.id) is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Preparation input cannot change while a job is active",
                )
            if song.source_video_path:
                cleanup.append(song.source_video_path)
            song.source_video_path = None
            if not song.active_bundle_id:
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
            if song.active_bundle_id and data["status"] != "ready":
                # An out-of-band replacement must not hide the active bundle.
                song.status = "ready"
            else:
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
        if _active_preparation(db, song.id) is not None:
            raise HTTPException(
                status_code=409,
                detail="Preparation input cannot change while a job is active",
            )
        folder = song_dir(song_id)
        try:
            destination = await _promote_video(video, folder)
        except (UploadTooLargeError, EmptyUploadError, OSError) as exc:
            raise _upload_http_error(exc) from exc

        cleanup = []
        if song.source_video_path and song.source_video_path != song.video_path:
            cleanup.append(song.source_video_path)
        song.source_video_path = stored_path(destination)
        if not song.active_bundle_id:
            cleanup.extend(
                value
                for value in (
                    song.video_path,
                    song.chart_path,
                    song.audio_path,
                    song.report_path,
                )
                if value
            )
            _clear_derived(song)
            song.video_path = stored_path(destination)
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
    report: UploadFile | None = File(
        None, description="dance.report.json from the pipeline"
    ),
    db: Session = Depends(get_db),
) -> SongOut:
    """Atomically promote one validated video/chart/audio/report generation."""
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        if _active_preparation(db, song.id) is not None:
            raise HTTPException(
                status_code=409,
                detail="Manual publication is unavailable while preparation is active",
            )
        video_path = resolve_stored_path(song.source_video_path or song.video_path)
        if video_path is None or not video_path.is_file():
            raise HTTPException(
                status_code=409,
                detail="Upload the reference video before the chart/audio bundle",
            )

        try:
            raw_chart = await read_upload_limited(chart, MAX_CHART_BYTES)
            validate_chart(raw_chart)
        except UploadTooLargeError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except (EmptyUploadError, ChartSyntaxError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid chart: {exc}") from exc
        except ChartValidationError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid chart: {exc}") from exc

        if report is not None:
            try:
                raw_report = await read_upload_limited(report, MAX_REPORT_BYTES)
            except UploadTooLargeError as exc:
                raise HTTPException(status_code=413, detail=str(exc)) from exc
            except EmptyUploadError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        else:
            raw_report = json.dumps(
                {
                    "version": "1.0",
                    "status": "ready",
                    "readiness": {"cache_ready_by_default": True},
                    "provenance": {"source": "manual_cache_upload"},
                }
            ).encode()

        folder = song_dir(song_id)
        staged_upload = folder / f".manual-upload-{uuid.uuid4().hex}"
        staged_upload.mkdir()
        audio_suffix = safe_suffix(audio.filename, ".wav")
        try:
            staged_audio = await stage_upload(
                audio,
                staged_upload,
                prefix="audio",
                suffix=audio_suffix,
                max_bytes=MAX_AUDIO_BYTES,
            )
        except (UploadTooLargeError, EmptyUploadError, OSError) as exc:
            shutil.rmtree(staged_upload, ignore_errors=True)
            raise _upload_http_error(exc) from exc

        try:
            publish_bundle(
                db,
                song,
                video_path=video_path,
                chart_bytes=raw_chart,
                audio_path=staged_audio,
                report_bytes=raw_report,
            )
        except MediaValidationError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid media: {exc}") from exc
        except ReportValidationError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid report: {exc}") from exc
        except (ChartSyntaxError, ChartValidationError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid chart: {exc}") from exc
        except Exception as exc:
            logger.exception("Could not commit chart/audio bundle")
            raise HTTPException(
                status_code=500, detail="Could not commit playable bundle"
            ) from exc
        finally:
            shutil.rmtree(staged_upload, ignore_errors=True)
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


@app.get("/songs/{song_id}/report")
def get_report(song_id: str, db: Session = Depends(get_db)) -> FileResponse:
    song = _get_song(db, song_id)
    path = _ready_file(song, song.report_path, "Report")
    return FileResponse(
        path, media_type="application/json", filename="dance.report.json"
    )


@app.get("/songs/{song_id}/bundles/{bundle_id}/{asset}")
def get_bundle_asset(
    song_id: str,
    bundle_id: str,
    asset: str,
    db: Session = Depends(get_db),
) -> FileResponse:
    _get_song(db, song_id)
    path = bundle_asset_path(song_id, bundle_id, asset)
    if path is None:
        raise HTTPException(status_code=404, detail="Bundle asset not found")
    response_options = {
        "video": {"filename": "video.mp4", "media_type": "video/mp4"},
        "chart": {"filename": "dance.json", "media_type": "application/json"},
        "audio": {"filename": "audio.wav", "media_type": "audio/wav"},
        "report": {
            "filename": "dance.report.json",
            "media_type": "application/json",
        },
    }
    options = response_options.get(asset)
    if options is None:
        raise HTTPException(status_code=404, detail="Bundle asset not found")
    return FileResponse(path, **options)


def _get_preparation(
    db: Session, song_id: str, job_id: str
) -> PreparationJob:
    _get_song(db, song_id)
    try:
        uuid.UUID(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Preparation not found") from exc
    job = db.scalar(
        select(PreparationJob).where(
            PreparationJob.id == job_id,
            PreparationJob.song_id == song_id,
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Preparation not found")
    return job


def _preparation_source(song: Song, preferred: str | None = None) -> str:
    uploaded = resolve_stored_path(song.source_video_path)
    has_upload = bool(uploaded and uploaded.is_file())
    if preferred == "upload":
        if not has_upload:
            raise HTTPException(
                status_code=409, detail="Uploaded preparation input is unavailable"
            )
        return "upload"
    if preferred == "url":
        if not song.source_url:
            raise HTTPException(status_code=409, detail="source_url is unavailable")
        return "url"
    if has_upload:
        return "upload"
    if song.source_url:
        return "url"
    raise HTTPException(
        status_code=409,
        detail="Upload a reference video or set source_url before preparing",
    )


def _enqueue_preparation(
    db: Session,
    song: Song,
    *,
    source_kind: str | None = None,
    retried_from_id: str | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
) -> tuple[PreparationJob, bool]:
    active = _active_preparation(db, song.id)
    if active is not None:
        return active, False
    selected_source = _preparation_source(song, source_kind)
    attempt = int(
        db.scalar(
            select(func.max(PreparationJob.attempt)).where(
                PreparationJob.song_id == song.id
            )
        )
        or 0
    ) + 1
    job = PreparationJob(
        id=str(uuid.uuid4()),
        song_id=song.id,
        status="queued",
        stage="queued",
        attempt=attempt,
        source_kind=selected_source,
        retried_from_id=retried_from_id,
        start_time=start_time,
        end_time=end_time,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        active = _active_preparation(db, song.id)
        if active is not None:
            return active, False
        raise
    db.refresh(job)
    return job, True


def _notify_preparation_worker(request: Request) -> None:
    worker = getattr(request.app.state, "preparation_worker", None)
    if worker is not None:
        worker.notify()


@app.post(
    "/songs/{song_id}/preparations",
    response_model=PreparationOut,
    status_code=202,
)
async def create_preparation(
    song_id: str,
    request: Request,
    body: PreparationCreate | None = None,
    db: Session = Depends(get_db),
) -> PreparationOut:
    async with _lock_for(song_id):
        song = _get_song(db, song_id)
        try:
            options = body or PreparationCreate()
            job, created = _enqueue_preparation(
                db,
                song,
                source_kind=options.source_kind,
                start_time=options.start_time,
                end_time=options.end_time,
            )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=409, detail="Could not create preparation job"
            ) from exc
        if created:
            _notify_preparation_worker(request)
        return _preparation_out(job)


@app.get(
    "/songs/{song_id}/preparations/{job_id}",
    response_model=PreparationOut,
)
def get_preparation(
    song_id: str, job_id: str, db: Session = Depends(get_db)
) -> PreparationOut:
    return _preparation_out(_get_preparation(db, song_id, job_id))


@app.post(
    "/songs/{song_id}/preparations/{job_id}/retry",
    response_model=PreparationOut,
    status_code=202,
)
async def retry_preparation(
    song_id: str,
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> PreparationOut:
    async with _lock_for(song_id):
        previous = _get_preparation(db, song_id, job_id)
        if previous.status != "failed":
            raise HTTPException(
                status_code=409, detail="Only failed preparations can be retried"
            )
        song = _get_song(db, song_id)
        try:
            job, created = _enqueue_preparation(
                db,
                song,
                source_kind=previous.source_kind,
                retried_from_id=previous.id,
                start_time=previous.start_time,
                end_time=previous.end_time,
            )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=409, detail="Could not retry preparation job"
            ) from exc
        if created:
            _notify_preparation_worker(request)
        return _preparation_out(job)


def _preparation_artifact(
    song_id: str,
    job_id: str,
    attribute: str,
    filename: str,
    media_type: str,
    db: Session,
) -> FileResponse:
    job = _get_preparation(db, song_id, job_id)
    path = resolve_stored_path(getattr(job, attribute))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Preparation artifact not found")
    return FileResponse(path, filename=filename, media_type=media_type)


@app.get("/songs/{song_id}/preparations/{job_id}/report")
def get_preparation_report(
    song_id: str, job_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    return _preparation_artifact(
        song_id,
        job_id,
        "report_path",
        "dance.report.json",
        "application/json",
        db,
    )


@app.get("/songs/{song_id}/preparations/{job_id}/diagnostic")
def get_preparation_diagnostic(
    song_id: str, job_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    return _preparation_artifact(
        song_id,
        job_id,
        "diagnostic_path",
        "dance.tracking.json",
        "application/json",
        db,
    )


@app.get("/songs/{song_id}/preparations/{job_id}/diagnostic-video")
def get_preparation_diagnostic_video(
    song_id: str, job_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    return _preparation_artifact(
        song_id,
        job_id,
        "diagnostic_video_path",
        "dance.tracking.mp4",
        "video/mp4",
        db,
    )


@app.post("/songs/{song_id}/plays", response_model=PlayOut, status_code=201)
def record_play(
    song_id: str, body: PlayCreate, db: Session = Depends(get_db)
) -> PlayOut:
    song = _get_song(db, song_id)
    bundle_id = body.bundle_id or song.active_bundle_id
    if not bundle_id or bundle_asset_path(song_id, bundle_id, "chart") is None:
        raise HTTPException(
            status_code=409, detail="A valid playable bundle_id is required"
        )
    play = Play(
        id=str(uuid.uuid4()),
        song_id=song_id,
        bundle_id=bundle_id,
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
