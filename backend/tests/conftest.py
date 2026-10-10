import atexit
import os
import shutil
import tempfile
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="dancify-backend-tests-"))
os.environ["DANCIFY_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["DANCIFY_PREPARATION_WORKER_ENABLED"] = "0"
atexit.register(shutil.rmtree, TEST_DATA_DIR, ignore_errors=True)

from app import bundles  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.paths import SONGS_DIR  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_database(
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[None, None, None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    shutil.rmtree(SONGS_DIR, ignore_errors=True)
    SONGS_DIR.mkdir(parents=True)
    monkeypatch.setattr(
        bundles,
        "validate_bundle_media",
        lambda *_args, **_kwargs: {
            "container": "mp4",
            "video_codec": "h264",
            "audio_codec": "aac",
            "duration": 4.0,
            "aspect_ratio": 1.0,
        },
    )
    yield
    Base.metadata.drop_all(bind=engine)
    shutil.rmtree(SONGS_DIR, ignore_errors=True)
    SONGS_DIR.mkdir(parents=True)


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
