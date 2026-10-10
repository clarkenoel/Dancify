"""Single-process durable preparation queue backed by SQLite."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select

from .bundles import publish_bundle
from .db import SessionLocal
from .models import PreparationJob, Song, utcnow
from .paths import REPO_ROOT, resolve_stored_path, song_dir, stored_path

logger = logging.getLogger(__name__)

PIPELINE_DRIVER = REPO_ROOT / "pipeline" / "prepare_song.py"
DEFAULT_PIPELINE_PYTHON = REPO_ROOT / "pipeline" / ".venv" / "bin" / "python"
POLL_SECONDS = float(os.environ.get("DANCIFY_PREPARATION_POLL_SECONDS", "0.5"))
JOB_TIMEOUT_SECONDS = float(
    os.environ.get("DANCIFY_PREPARATION_TIMEOUT_SECONDS", "7200")
)
ERROR_CODES = {
    "download_failed",
    "unsupported_media",
    "timing_required",
    "tracking_failed",
    "validation_failed",
    "internal",
    "interrupted",
}


def worker_enabled() -> bool:
    return os.environ.get("DANCIFY_PREPARATION_WORKER_ENABLED", "1").lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _pipeline_python() -> Path:
    # Resolving a venv's python symlink invokes the base interpreter and loses
    # its site-packages. Preserve the configured executable path.
    return Path(
        os.environ.get("DANCIFY_PIPELINE_PYTHON", str(DEFAULT_PIPELINE_PYTHON))
    ).expanduser().absolute()


def recover_interrupted_jobs() -> int:
    """Deterministically fail jobs left processing by an earlier process."""
    recovered = 0
    with SessionLocal() as db:
        jobs = db.scalars(
            select(PreparationJob).where(PreparationJob.status == "processing")
        ).all()
        for job in jobs:
            job.status = "failed"
            job.stage = "failed"
            job.error_code = "interrupted"
            job.error_message = (
                "Preparation was interrupted by a backend restart; retry this job"
            )
            job.finished_at = utcnow()
            job.updated_at = utcnow()
            song = db.get(Song, job.song_id)
            if song is not None and not song.active_bundle_id:
                song.status = "failed"
                song.error_message = job.error_message
                song.updated_at = utcnow()
            recovered += 1
        db.commit()
    return recovered


def _claim_next_job() -> str | None:
    with SessionLocal() as db:
        job = db.scalar(
            select(PreparationJob)
            .where(PreparationJob.status == "queued")
            .order_by(PreparationJob.created_at.asc())
            .limit(1)
        )
        if job is None:
            return None
        job.status = "processing"
        job.stage = "starting"
        job.started_at = utcnow()
        job.updated_at = utcnow()
        song = db.get(Song, job.song_id)
        if song is None:
            job.status = "failed"
            job.stage = "failed"
            job.error_code = "internal"
            job.error_message = "Song was deleted before preparation started"
            job.finished_at = utcnow()
        elif not song.active_bundle_id:
            song.status = "processing"
            song.error_message = None
            song.updated_at = utcnow()
        db.commit()
        return job.id


def _job_input(
    job_id: str,
) -> tuple[str, str, Path, float | None, float | None] | None:
    with SessionLocal() as db:
        job = db.get(PreparationJob, job_id)
        if job is None or job.status != "processing":
            return None
        song = db.get(Song, job.song_id)
        if song is None:
            return None
        if job.source_kind == "upload":
            source = resolve_stored_path(song.source_video_path or song.video_path)
            if source is None or not source.is_file():
                return (
                    job.song_id,
                    "",
                    song_dir(song.id) / "preparations" / job.id,
                    job.start_time,
                    job.end_time,
                )
            input_value = str(source)
        else:
            input_value = song.source_url or ""
        output_dir = song_dir(song.id) / "preparations" / job.id
        output_dir.mkdir(parents=True, exist_ok=True)
        return song.id, input_value, output_dir, job.start_time, job.end_time


def _set_stage(job_id: str, stage: str) -> None:
    with SessionLocal() as db:
        job = db.get(PreparationJob, job_id)
        if job is not None and job.status == "processing":
            job.stage = stage
            job.updated_at = utcnow()
            db.commit()


def _stored_if_file(path_value: Any) -> str | None:
    if not isinstance(path_value, str):
        return None
    path = Path(path_value)
    if not path.is_file():
        return None
    try:
        return stored_path(path)
    except ValueError:
        return None


def _fail_job(
    job_id: str,
    error_code: str,
    message: str,
    manifest: dict[str, Any] | None = None,
) -> None:
    code = error_code if error_code in ERROR_CODES else "internal"
    safe_message = message[:4000] or "Preparation failed"
    with SessionLocal() as db:
        job = db.get(PreparationJob, job_id)
        if job is None:
            return
        if job.status not in {"queued", "processing"}:
            return
        job.status = "failed"
        job.stage = "failed"
        job.error_code = code
        job.error_message = safe_message
        job.finished_at = utcnow()
        job.updated_at = utcnow()
        if manifest:
            job.report_path = _stored_if_file(manifest.get("report"))
            job.diagnostic_path = _stored_if_file(manifest.get("diagnostic"))
            job.diagnostic_video_path = _stored_if_file(
                manifest.get("diagnostic_video")
            )
        song = db.get(Song, job.song_id)
        if song is not None and not song.active_bundle_id:
            song.status = "failed"
            song.error_message = safe_message
            song.updated_at = utcnow()
        db.commit()


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _publish_result(job_id: str, manifest: dict[str, Any]) -> None:
    required = {
        name: Path(str(manifest.get(name, "")))
        for name in ("video", "chart", "audio", "report")
    }
    if any(not path.is_file() for path in required.values()):
        raise ValueError("Pipeline did not produce a complete bundle")
    with SessionLocal() as db:
        job = db.get(PreparationJob, job_id)
        if job is None or job.status != "processing":
            raise ValueError("Preparation job is no longer active")
        song = db.get(Song, job.song_id)
        if song is None:
            raise ValueError("Song was deleted before bundle publication")
        job.stage = "publish"
        job.updated_at = utcnow()
        publish_bundle(
            db,
            song,
            video_path=required["video"],
            chart_bytes=required["chart"].read_bytes(),
            audio_path=required["audio"],
            report_bytes=required["report"].read_bytes(),
            preparation_job=job,
        )


class PreparationWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()
        self._stopping = False
        self._process: asyncio.subprocess.Process | None = None
        self._current_job_id: str | None = None

    async def start(self) -> None:
        recovered = await asyncio.to_thread(recover_interrupted_jobs)
        if recovered:
            logger.warning("Marked %d interrupted preparation job(s) failed", recovered)
        self._stopping = False
        self._task = asyncio.create_task(
            self._run(), name=f"preparation-worker-{uuid.uuid4().hex[:8]}"
        )

    def notify(self) -> None:
        self._wake.set()

    async def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        if self._current_job_id is not None:
            await asyncio.to_thread(
                _fail_job,
                self._current_job_id,
                "interrupted",
                "Preparation was interrupted by backend shutdown; retry this job",
            )
        if self._process is not None and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except TimeoutError:
                self._process.kill()
                await self._process.wait()
        if self._task is not None:
            await self._task
            self._task = None

    async def _run(self) -> None:
        while not self._stopping:
            job_id = await asyncio.to_thread(_claim_next_job)
            if job_id is None:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=POLL_SECONDS)
                except TimeoutError:
                    pass
                continue
            self._current_job_id = job_id
            try:
                await self._run_job(job_id)
            finally:
                self._current_job_id = None

    async def _run_job(self, job_id: str) -> None:
        details = await asyncio.to_thread(_job_input, job_id)
        if details is None:
            return
        _, input_value, output_dir, start_time, end_time = details
        if not input_value:
            await asyncio.to_thread(
                _fail_job,
                job_id,
                "unsupported_media",
                "Preparation input is unavailable; upload a local video or set source_url",
            )
            return
        pipeline_python = _pipeline_python()
        if not pipeline_python.is_file() or not PIPELINE_DRIVER.is_file():
            await asyncio.to_thread(
                _fail_job,
                job_id,
                "internal",
                "Pipeline runtime is not installed; configure DANCIFY_PIPELINE_PYTHON",
            )
            return

        manifest_path = output_dir / "preparation.json"
        await asyncio.to_thread(_set_stage, job_id, "pipeline")
        try:
            command = [
                str(pipeline_python),
                str(PIPELINE_DRIVER),
                "--input",
                input_value,
                "--output-dir",
                str(output_dir),
                "--manifest",
                str(manifest_path),
            ]
            if start_time is not None:
                command.extend(["--start-time", str(start_time)])
            if end_time is not None:
                command.extend(["--end-time", str(end_time)])
            self._process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            deadline = asyncio.get_running_loop().time() + JOB_TIMEOUT_SECONDS
            while True:
                try:
                    return_code = await asyncio.wait_for(
                        self._process.wait(), timeout=0.5
                    )
                    break
                except TimeoutError:
                    progress = await asyncio.to_thread(
                        _load_manifest, manifest_path
                    )
                    stage = progress.get("stage")
                    if progress.get("status") == "processing" and isinstance(
                        stage, str
                    ):
                        await asyncio.to_thread(_set_stage, job_id, stage)
                    if asyncio.get_running_loop().time() >= deadline:
                        self._process.kill()
                        await self._process.wait()
                        await asyncio.to_thread(
                            _fail_job,
                            job_id,
                            "internal",
                            "Preparation exceeded the configured timeout",
                        )
                        return
        except OSError:
            await asyncio.to_thread(
                _fail_job,
                job_id,
                "internal",
                "Could not start the configured pipeline runtime",
            )
            return
        finally:
            self._process = None

        manifest = await asyncio.to_thread(_load_manifest, manifest_path)
        if return_code != 0 or manifest.get("status") != "succeeded":
            await asyncio.to_thread(
                _fail_job,
                job_id,
                str(manifest.get("error_code", "internal")),
                str(manifest.get("error_message", "Pipeline preparation failed")),
                manifest,
            )
            return
        await asyncio.to_thread(_set_stage, job_id, "validation")
        try:
            await asyncio.to_thread(_publish_result, job_id, manifest)
        except Exception:
            logger.exception("Bundle publication failed for preparation %s", job_id)
            await asyncio.to_thread(
                _fail_job,
                job_id,
                "validation_failed",
                "Prepared output failed bundle validation",
                manifest,
            )
