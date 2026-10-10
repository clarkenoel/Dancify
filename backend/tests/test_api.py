from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import main
from app.db import SessionLocal
from app.models import Play
from app.paths import SONGS_DIR

VIDEO = b"0123456789-reference-video"
AUDIO = b"abcdefghij-audio"


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
                "keyframe_landmarks": [[0.0, 0.0, 0.0, 1.0]] * 33,
                "is_hold": False,
            }
        ],
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

    assert response.status_code == 400
    assert client.get(f"/songs/{song_id}/chart").content == old_chart
    assert client.get(f"/songs/{song_id}/audio").content == old_audio
    detail = client.get(f"/songs/{song_id}").json()
    assert detail["status"] == "ready"
    assert detail["bpm"] == 120


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


def test_source_and_video_replacements_invalidate_derived_data(
    client: TestClient,
) -> None:
    song = ready_song(client)
    song_id = str(song["id"])
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
    assert changed_source.json()["status"] == "pending"
    assert changed_source.json()["has_video"] is False
    assert changed_source.json()["has_chart"] is False
    assert changed_source.json()["has_audio"] is False
    assert changed_source.json()["bpm"] is None
    assert changed_source.json()["error_message"] is None
    assert not list(folder.glob("bundle-*"))

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
    assert replaced_video.json()["status"] == "pending"
    assert replaced_video.json()["has_video"] is True
    assert replaced_video.json()["has_chart"] is False
    assert replaced_video.json()["has_audio"] is False
    assert not list(folder.glob("bundle-*"))
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

    for source_url in ("not a url", "ftp://example.test/video"):
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
