from __future__ import annotations

import json
import sys
import textwrap
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import main
from app import preparation
from app.db import SessionLocal, migrate_sqlite
from app.models import Play, PreparationJob, utcnow
from app.paths import SONGS_DIR
from app.preparation import recover_interrupted_jobs

VIDEO = b"0123456789-reference-video"
AUDIO = b"abcdefghij-audio"
GAMEPLAY_JOINTS = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)


def valid_normalized_pose() -> list[list[float]]:
    pose = [[0.0, 0.0, 0.0, 0.1] for _ in range(33)]
    geometry = {
        11: (-0.5, -1.0, 0.0),
        12: (0.5, -1.0, 0.0),
        13: (-0.8, -0.5, 0.0),
        14: (0.8, -0.5, 0.0),
        15: (-1.0, 0.0, 0.0),
        16: (1.0, 0.0, 0.0),
        23: (-0.25, 0.0, 0.0),
        24: (0.25, 0.0, 0.0),
        25: (-0.3, 0.8, 0.0),
        26: (0.3, 0.8, 0.0),
        27: (-0.3, 1.6, 0.0),
        28: (0.3, 1.6, 0.0),
    }
    for index, coordinates in geometry.items():
        pose[index] = [*coordinates, 0.95]
    return pose


def chart(*, bpm: float = 120, move_id: str = "m0") -> dict[str, object]:
    return {
        "version": "1.0",
        "bpm": bpm,
        "beat_times": [0.5, 1.0, 1.5],
        "duration": 4.0,
        "moves": [
            {
                "id": move_id,
                "start": 1.0,
                "end": 2.0,
                "keyframe_landmarks": valid_normalized_pose(),
                "is_hold": False,
            }
        ],
    }


def valid_report(payload=None):
    payload = payload or chart()
    return {
        "version": "1.0",
        "readiness": {"cache_ready_by_default": True, "synthetic_timing": False, "solo_cfr_mvp": True},
        "normalization": {"coordinate_space": "mediapipe_image", "aspect_ratio": 1.0, "x_z_scaled_by_aspect_ratio": True},
        "timing": {"source": "audio", "synthetic": False, "bpm": payload["bpm"], "beat_times": payload["beat_times"]},
        "tracking": {"valid_frames": 100, "total_frames": 100, "valid_frame_ratio": 1.0, "longest_invalid_seconds": 0.0, "trailing_invalid_seconds": 0.0},
    }


def create_song(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/songs",
        data={"title": "Demo"},
        files={"video": ("clip.mp4", VIDEO, "video/mp4")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload_bundle(
    client: TestClient,
    song_id: str,
    *,
    payload: dict[str, object] | list[object] | None = None,
    audio: bytes = AUDIO,
) -> object:
    return client.put(
        f"/songs/{song_id}/chart",
        files={
            "chart": (
                "dance.json",
                json.dumps(chart() if payload is None else payload).encode(),
                "application/json",
            ),
            "audio": ("audio.wav", audio, "audio/wav"),
            "report": ("dance.report.json", json.dumps(valid_report(payload) if isinstance(payload, dict) and "bpm" in payload else valid_report()).encode(), "application/json"),
        },
    )


def ready_song(client: TestClient) -> dict[str, object]:
    song = create_song(client)
    response = upload_bundle(client, str(song["id"]))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        [],
        {
            **chart(),
            "beat_times": [1.0, 0.5],
        },
        {
            **chart(),
            "moves": [{**chart()["moves"][0], "end": 9.0}],  # type: ignore[index]
        },
        {**chart(), "beat_times": []},
        {**chart(), "moves": []},
    ],
)
def test_invalid_chart_never_overwrites_ready_cache(
    client: TestClient, payload: object
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    old_chart = client.get(f"/songs/{song_id}/chart").content
    old_audio = client.get(f"/songs/{song_id}/audio").content

    response = upload_bundle(
        client,
        song_id,
        payload=payload,  # type: ignore[arg-type]
        audio=b"replacement-audio",
    )

    assert response.status_code == 422
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert client.get(f"/songs/{song_id}/audio").content == old_audio
    detail = client.get(f"/songs/{song_id}").json()
    assert detail["status"] == "ready"
    assert detail["bpm"] == 120


@pytest.mark.parametrize("failure", ["all-zero", "low-visibility"])
def test_unusable_pose_cannot_create_or_overwrite_ready_cache(
    client: TestClient, failure: str
) -> None:
    invalid = chart()
    if failure == "all-zero":
        landmarks = [[0.0, 0.0, 0.0, 1.0] for _ in range(33)]
    else:
        landmarks = valid_normalized_pose()
        for index in GAMEPLAY_JOINTS:
            landmarks[index][3] = 0.34
    invalid["moves"][0]["keyframe_landmarks"] = landmarks  # type: ignore[index]

    song = create_song(client)
    song_id = str(song["id"])
    rejected_initial = upload_bundle(client, song_id, payload=invalid)
    assert rejected_initial.status_code == 422
    pending = client.get(f"/songs/{song_id}").json()
    assert pending["status"] == "pending"
    assert pending["has_chart"] is False
    assert pending["has_audio"] is False
    assert not list((SONGS_DIR / song_id).glob("bundle-*"))

    valid = upload_bundle(client, song_id)
    assert valid.status_code == 200
    old_chart = client.get(f"/songs/{song_id}/chart").content
    old_audio = client.get(f"/songs/{song_id}/audio").content

    rejected_replacement = upload_bundle(
        client,
        song_id,
        payload=invalid,
        audio=b"invalid-replacement-audio",
    )
    assert rejected_replacement.status_code == 422
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert client.get(f"/songs/{song_id}/audio").content == old_audio
    assert client.get(f"/songs/{song_id}").json()["status"] == "ready"


def test_valid_normalized_pose_is_accepted(client: TestClient) -> None:
    song = create_song(client)
    response = upload_bundle(client, str(song["id"]), payload=chart())

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    stored = client.get(f"/songs/{song['id']}/chart").json()
    assert stored["moves"][0]["keyframe_landmarks"] == valid_normalized_pose()


def test_ready_requires_reference_video_chart_and_audio(client: TestClient) -> None:
    created = client.post(
        "/songs/json",
        json={"title": "URL song", "source_url": "https://example.test/video"},
    ).json()
    song_id = created["id"]

    assert client.patch(f"/songs/{song_id}", json={"status": "ready"}).status_code == 409
    assert upload_bundle(client, song_id).status_code == 409

    video = client.post(
        f"/songs/{song_id}/video",
        files={"video": ("clip.mp4", VIDEO, "video/mp4")},
    )
    assert video.status_code == 200

    missing_audio = client.put(
        f"/songs/{song_id}/chart",
        files={
            "chart": (
                "dance.json",
                json.dumps(chart()).encode(),
                "application/json",
            )
        },
    )
    assert missing_audio.status_code == 422

    ready = upload_bundle(client, song_id)
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["has_video"] is True
    assert ready.json()["has_chart"] is True
    assert ready.json()["has_audio"] is True


def test_extreme_numeric_literal_is_invalid_chart(client: TestClient) -> None:
    song = create_song(client)
    huge_number = b"9" * 5000
    raw = (
        b'{"version":"1.0","bpm":'
        + huge_number
        + b',"beat_times":[0.5],"duration":4,"moves":[]}'
    )
    response = client.put(
        f"/songs/{song['id']}/chart",
        files={
            "chart": ("dance.json", raw, "application/json"),
            "audio": ("audio.wav", AUDIO, "audio/wav"),
        },
    )
    assert response.status_code == 400


def test_source_and_video_replacements_preserve_active_bundle(
    client: TestClient,
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    active_bundle_id = str(song["active_bundle_id"])
    old_chart = client.get(f"/songs/{song_id}/chart").content
    folder = SONGS_DIR / song_id
    assert len(list(folder.glob("bundle-*"))) == 1

    changed_source = client.patch(
        f"/songs/{song_id}",
        json={
            "source_url": "https://example.test/replacement",
            "error_message": "stale error",
        },
    )
    assert changed_source.status_code == 200
    assert changed_source.json()["status"] == "ready"
    assert changed_source.json()["has_video"] is True
    assert changed_source.json()["has_chart"] is True
    assert changed_source.json()["has_audio"] is True
    assert changed_source.json()["bpm"] == 120
    assert changed_source.json()["error_message"] is None
    assert changed_source.json()["active_bundle_id"] == active_bundle_id
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert len(list(folder.glob("bundle-*"))) == 1

    client.post(
        f"/songs/{song_id}/video",
        files={"video": ("second.mp4", b"second-video", "video/mp4")},
    )
    assert upload_bundle(client, song_id).status_code == 200
    replaced_video = client.post(
        f"/songs/{song_id}/video",
        files={"video": ("third.webm", b"third-video", "video/webm")},
    )
    assert replaced_video.status_code == 200
    assert replaced_video.json()["status"] == "ready"
    assert replaced_video.json()["has_video"] is True
    assert replaced_video.json()["has_chart"] is True
    assert replaced_video.json()["has_audio"] is True
    assert len(list(folder.glob("bundle-*"))) == 2
    assert len(list(folder.glob("video-*"))) == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"score": -1},
        {"accuracy": -0.1},
        {"accuracy": 1.1},
        {"max_combo": -1},
        {"judgments": {"BANANA": 1}},
        {"judgments": {"MISS": -1}},
    ],
)
def test_play_values_are_validated(client: TestClient, payload: object) -> None:
    song = create_song(client)
    response = client.post(f"/songs/{song['id']}/plays", json=payload)
    assert response.status_code == 422


def test_sqlite_foreign_keys_are_enabled() -> None:
    session = SessionLocal()
    try:
        assert session.connection().exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        session.add(
            Play(
                id="orphan",
                song_id="00000000-0000-0000-0000-000000000000",
                player_name="tester",
                score=1,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
    finally:
        session.rollback()
        session.close()


def test_cors_only_allows_local_vite_origins(client: TestClient) -> None:
    allowed = client.options(
        "/songs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in allowed.headers

    denied = client.options(
        "/songs",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_video_and_audio_support_byte_ranges(client: TestClient) -> None:
    song = ready_song(client)
    song_id = str(song["id"])

    video = client.get(
        f"/songs/{song_id}/video", headers={"Range": "bytes=2-5"}
    )
    assert video.status_code == 206
    assert video.content == VIDEO[2:6]
    assert video.headers["content-range"] == f"bytes 2-5/{len(VIDEO)}"

    audio = client.get(
        f"/songs/{song_id}/audio", headers={"Range": "bytes=1-4"}
    )
    assert audio.status_code == 206
    assert audio.content == AUDIO[1:5]
    assert audio.headers["content-range"] == f"bytes 1-4/{len(AUDIO)}"


def test_failed_bundle_commit_rolls_back_to_previous_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    old_chart = client.get(f"/songs/{song_id}/chart").content
    old_audio = client.get(f"/songs/{song_id}/audio").content
    folder = SONGS_DIR / song_id
    assert len(list(folder.glob("bundle-*"))) == 1

    def fail_commit(_: Session) -> None:
        raise RuntimeError("simulated commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        response = upload_bundle(
            client,
            song_id,
            payload=chart(bpm=90, move_id="replacement"),
            audio=b"replacement",
        )
    assert response.status_code == 500
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert client.get(f"/songs/{song_id}/audio").content == old_audio
    assert len(list(folder.glob("bundle-*"))) == 1


def test_failed_video_commit_preserves_previous_ready_bundle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    old_video = client.get(f"/songs/{song_id}/video").content
    old_chart = client.get(f"/songs/{song_id}/chart").content

    def fail_commit(_: Session) -> None:
        raise RuntimeError("simulated commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        response = client.post(
            f"/songs/{song_id}/video",
            files={"video": ("replacement.mp4", b"replacement-video", "video/mp4")},
        )

    assert response.status_code == 500
    assert client.get(f"/songs/{song_id}/video").content == old_video
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert client.get(f"/songs/{song_id}").json()["status"] == "ready"


def test_upload_limits_reject_before_replacing_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    old_chart = client.get(f"/songs/{song_id}/chart").content

    monkeypatch.setattr(main, "MAX_CHART_BYTES", 10)
    response = upload_bundle(client, song_id, payload=chart(bpm=90))

    assert response.status_code == 413
    assert client.get(f"/songs/{song_id}/chart").content == old_chart


def test_create_and_update_normalize_input(client: TestClient) -> None:
    blank = client.post(
        "/songs/json",
        json={"title": "   ", "source_url": "https://example.test/video"},
    )
    assert blank.status_code == 422

    song = create_song(client)
    song_id = str(song["id"])
    null_title = client.patch(f"/songs/{song_id}", json={"title": None})
    assert null_title.status_code == 422
    too_long = client.post(
        "/songs",
        data={"title": "x" * 257, "source_url": "https://example.test/video"},
    )
    assert too_long.status_code == 422

    for source_url in (
        "not a url",
        "ftp://example.test/video",
        "https://user:secret@example.test/video",
    ):
        invalid_url = client.post(
            "/songs/json",
            json={"title": "Bad URL", "source_url": source_url},
        )
        assert invalid_url.status_code == 422


def test_startup_reconciles_interrupted_deletion(client: TestClient) -> None:
    song = create_song(client)
    song_id = str(song["id"])
    folder = SONGS_DIR / song_id
    tombstone = SONGS_DIR / f".deleted-{song_id}-simulated"
    folder.rename(tombstone)

    main._cleanup_tombstones()

    assert folder.exists()
    assert not tombstone.exists()
    assert client.get(f"/songs/{song_id}/video").status_code == 200


def test_delete_removes_song_directory(client: TestClient) -> None:
    song = ready_song(client)
    folder = SONGS_DIR / str(song["id"])
    assert folder.exists()

    response = client.delete(f"/songs/{song['id']}")

    assert response.status_code == 204
    assert not folder.exists()


@pytest.mark.parametrize("failure", ["overlap", "hold"])
def test_unsupported_move_timeline_semantics_are_rejected(
    client: TestClient, failure: str
) -> None:
    song = create_song(client)
    payload = chart()
    first = payload["moves"][0]  # type: ignore[index]
    if failure == "overlap":
        payload["moves"] = [  # type: ignore[index]
            first,
            {
                **first,
                "id": "m1",
                "start": 1.5,
                "end": 2.5,
            },
        ]
    else:
        payload["moves"] = [{**first, "is_hold": True}]  # type: ignore[index]

    response = upload_bundle(client, str(song["id"]), payload=payload)

    assert response.status_code == 422
    assert response.json()["detail"].startswith("Invalid chart:")


def test_immutable_bundle_routes_report_and_bundle_stamped_plays(
    client: TestClient,
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
    first_bundle = str(song["active_bundle_id"])

    for asset in ("video", "chart", "audio", "report"):
        response = client.get(
            f"/songs/{song_id}/bundles/{first_bundle}/{asset}"
        )
        assert response.status_code == 200
    report = client.get(
        f"/songs/{song_id}/bundles/{first_bundle}/report"
    ).json()
    assert report["cache"]["bundle_id"] == first_bundle
    assert report["cache"]["source_kind"] == "manual"

    first_play = client.post(
        f"/songs/{song_id}/plays",
        json={"player_name": "first", "score": 10},
    )
    assert first_play.status_code == 201
    assert first_play.json()["bundle_id"] == first_bundle

    replacement = client.post(
        f"/songs/{song_id}/video",
        files={"video": ("replacement.mp4", b"replacement", "video/mp4")},
    )
    assert replacement.status_code == 200
    assert replacement.json()["active_bundle_id"] == first_bundle
    second = upload_bundle(
        client,
        song_id,
        payload=chart(bpm=90, move_id="replacement"),
        audio=b"replacement-audio",
    )
    assert second.status_code == 200
    second_bundle = second.json()["active_bundle_id"]
    assert second_bundle != first_bundle
    assert (
        client.get(f"/songs/{song_id}/bundles/{first_bundle}/chart").status_code
        == 200
    )

    historical_play = client.post(
        f"/songs/{song_id}/plays",
        json={"player_name": "old bundle", "score": 5, "bundle_id": first_bundle},
    )
    assert historical_play.status_code == 201
    assert historical_play.json()["bundle_id"] == first_bundle
    latest_play = client.post(
        f"/songs/{song_id}/plays",
        json={"player_name": "new bundle", "score": 15},
    )
    assert latest_play.json()["bundle_id"] == second_bundle


def test_preparation_api_deduplicates_active_job_and_retries_failure(
    client: TestClient,
) -> None:
    song = client.post(
        "/songs/json",
        json={"title": "URL song", "source_url": "https://example.test/video"},
    ).json()
    song_id = str(song["id"])

    first = client.post(
        f"/songs/{song_id}/preparations",
        json={"source_kind": "url", "start_time": 1.0, "end_time": 15.0},
    )
    duplicate = client.post(f"/songs/{song_id}/preparations")

    assert first.status_code == 202
    assert duplicate.status_code == 202
    assert duplicate.json()["id"] == first.json()["id"]
    assert first.json()["status"] == "queued"
    assert first.json()["attempt"] == 1
    assert first.json()["source_kind"] == "url"
    assert first.json()["start_time"] == 1.0
    assert first.json()["end_time"] == 15.0
    assert (
        client.patch(
            f"/songs/{song_id}",
            json={"source_url": "https://example.test/changed"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/songs/{song_id}/video",
            files={"video": ("changed.mp4", b"changed", "video/mp4")},
        ).status_code
        == 409
    )
    assert (
        client.get(
            f"/songs/{song_id}/preparations/{first.json()['id']}"
        ).json()
        == first.json()
    )

    with SessionLocal() as db:
        job = db.get(PreparationJob, first.json()["id"])
        assert job is not None
        job.status = "failed"
        job.stage = "failed"
        job.error_code = "download_failed"
        job.error_message = "upload fallback"
        job.finished_at = utcnow()
        db.commit()

    retried = client.post(
        f"/songs/{song_id}/preparations/{first.json()['id']}/retry"
    )
    assert retried.status_code == 202
    assert retried.json()["id"] != first.json()["id"]
    assert retried.json()["attempt"] == 2
    assert retried.json()["retried_from_id"] == first.json()["id"]
    assert retried.json()["status"] == "queued"
    assert retried.json()["start_time"] == 1.0
    assert retried.json()["end_time"] == 15.0


def test_restart_marks_processing_job_interrupted(client: TestClient) -> None:
    song = client.post(
        "/songs/json",
        json={"title": "Interrupted", "source_url": "https://example.test/video"},
    ).json()
    queued = client.post(f"/songs/{song['id']}/preparations").json()
    with SessionLocal() as db:
        job = db.get(PreparationJob, queued["id"])
        assert job is not None
        job.status = "processing"
        job.stage = "pipeline"
        job.started_at = utcnow()
        db.commit()

    assert recover_interrupted_jobs() == 1
    recovered = client.get(
        f"/songs/{song['id']}/preparations/{queued['id']}"
    ).json()
    assert recovered["status"] == "failed"
    assert recovered["stage"] == "failed"
    assert recovered["error_code"] == "interrupted"
    assert recovered["finished_at"] is not None


def test_lifespan_worker_runs_pipeline_subprocess(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    driver = tmp_path / "fake_prepare.py"
    driver.write_text(
        textwrap.dedent(
            f"""
            import argparse
            import json
            from pathlib import Path

            parser = argparse.ArgumentParser()
            parser.add_argument("--input")
            parser.add_argument("--output-dir", type=Path)
            parser.add_argument("--manifest", type=Path)
            args = parser.parse_args()
            args.output_dir.mkdir(parents=True, exist_ok=True)
            video = args.output_dir / "video.mp4"
            chart_path = args.output_dir / "dance.json"
            audio = args.output_dir / "audio.wav"
            report = args.output_dir / "dance.report.json"
            video.write_bytes(Path(args.input).read_bytes())
            chart_path.write_text(json.dumps({chart()!r}))
            audio.write_bytes(b"audio")
            report.write_text(json.dumps({valid_report()!r}))
            args.manifest.write_text(json.dumps({{
                "status": "succeeded",
                "video": str(video.resolve()),
                "chart": str(chart_path.resolve()),
                "audio": str(audio.resolve()),
                "report": str(report.resolve()),
            }}))
            """
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("DANCIFY_PREPARATION_WORKER_ENABLED", "1")
    monkeypatch.setenv("DANCIFY_PIPELINE_PYTHON", sys.executable)
    monkeypatch.setattr(preparation, "PIPELINE_DRIVER", driver)
    monkeypatch.setattr(preparation, "POLL_SECONDS", 0.01)

    with TestClient(main.app, raise_server_exceptions=False) as worker_client:
        song = create_song(worker_client)
        queued = worker_client.post(
            f"/songs/{song['id']}/preparations"
        ).json()
        deadline = time.monotonic() + 3
        state = queued
        while state["status"] not in {"succeeded", "failed"}:
            assert time.monotonic() < deadline
            time.sleep(0.02)
            state = worker_client.get(
                f"/songs/{song['id']}/preparations/{queued['id']}"
            ).json()

        assert state["status"] == "succeeded", state
        assert state["stage"] == "complete"
        assert state["result_bundle_id"]
        detail = worker_client.get(f"/songs/{song['id']}").json()
        assert detail["active_bundle_id"] == state["result_bundle_id"]
        assert detail["active_preparation_job_id"] == queued["id"]


def test_sqlite_column_migration_is_idempotent(tmp_path) -> None:
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with legacy_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE songs (id VARCHAR(36) PRIMARY KEY, video_path VARCHAR(512))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE plays (id VARCHAR(36) PRIMARY KEY)"
        )
        connection.exec_driver_sql(
            "CREATE TABLE preparation_jobs (id VARCHAR(36) PRIMARY KEY)"
        )

    migrate_sqlite(legacy_engine)
    migrate_sqlite(legacy_engine)
    with legacy_engine.connect() as connection:
        song_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(songs)").all()
        }
        play_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(plays)").all()
        }
        preparation_columns = {
            row[1]
            for row in connection.exec_driver_sql(
                "PRAGMA table_info(preparation_jobs)"
            ).all()
        }
    assert {
        "source_video_path",
        "report_path",
        "active_bundle_id",
        "active_preparation_job_id",
    }.issubset(song_columns)
    assert "bundle_id" in play_columns
    assert {"start_time", "end_time"}.issubset(preparation_columns)
