import json
import uuid
import subprocess
import venv

import pytest

from app.db import SessionLocal
from app.models import Song
from test_api import AUDIO, chart, ready_song, valid_report


def test_worker_preserves_virtualenv_interpreter(monkeypatch, tmp_path):
    from app.preparation import _pipeline_python
    root = tmp_path / "pipeline-venv"
    venv.EnvBuilder(with_pip=False, symlinks=True).create(root)
    interpreter = root / "bin" / "python"
    monkeypatch.setenv("DANCIFY_PIPELINE_PYTHON", str(interpreter))
    process = subprocess.run([str(_pipeline_python()), "-c", "import sys; print(sys.prefix)"], capture_output=True, text=True, check=True)
    assert process.stdout.strip() == str(root)


@pytest.mark.parametrize("failure", ["missing", "legacy", "synthetic", "failed", "beats", "tracking", "aspect"])
def test_report_failure_preserves_ready_generation(client, failure):
    song = ready_song(client)
    before = client.get(f"/songs/{song['id']}/chart").content
    report = valid_report()
    if failure == "legacy":
        del report["normalization"]
    elif failure == "synthetic":
        report["timing"]["synthetic"] = True
    elif failure == "failed":
        report["readiness"]["cache_ready_by_default"] = False
    elif failure == "beats":
        report["timing"]["beat_times"] = [0.2]
    elif failure == "tracking":
        report["tracking"]["longest_invalid_seconds"] = 2.16
    elif failure == "aspect":
        report["normalization"]["aspect_ratio"] = 0.5625
    files = {"chart": ("dance.json", json.dumps(chart()), "application/json"), "audio": ("audio.wav", AUDIO, "audio/wav")}
    if failure != "missing":
        files["report"] = ("report.json", json.dumps(report), "application/json")
    response = client.put(f"/songs/{song['id']}/chart", files=files)
    assert response.status_code == 422, response.text
    assert client.get(f"/songs/{song['id']}/chart").content == before
    assert client.get(f"/songs/{song['id']}").json()["active_bundle_id"] == song["active_bundle_id"]


def test_legacy_rows_are_preserved_for_regeneration(client):
    song = ready_song(client)
    with SessionLocal() as db:
        row = db.get(Song, song["id"])
        row.report_path = None
        row.active_bundle_id = None
        db.commit()
    detail = client.get(f"/songs/{song['id']}").json()
    assert detail["has_chart"] and not detail["has_report"]
    assert detail["active_bundle_id"] is None
    assert client.post(f"/songs/{song['id']}/preparations", json={"source_kind": "upload"}).status_code == 202


def test_result_retry_is_idempotent_and_conflicting_data_is_rejected(client):
    song = ready_song(client)
    url = f"/songs/{song['id']}/plays"
    result = {"client_session_id": str(uuid.uuid4()), "bundle_id": song["active_bundle_id"], "mode": "keyboard_practice", "score": 100, "tracking_coverage": None}
    first = client.post(url, json=result)
    retry = client.post(url, json=result)
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert first.json()["mode"] == "keyboard_practice"
    assert len(client.get(url).json()) == 1
    assert client.post(url, json={**result, "score": 200}).status_code == 409
