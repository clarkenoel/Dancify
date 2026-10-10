import os
import uuid
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
DATA_DIR = Path(os.environ.get("DANCIFY_DATA_DIR", BACKEND_ROOT / "data")).resolve()
DB_PATH = DATA_DIR / "dancify.db"
SONGS_DIR = DATA_DIR / "songs"
CHART_SCHEMA_PATH = REPO_ROOT / "schema" / "dance.schema.json.json"


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)


def song_dir(song_id: str, *, create: bool = True) -> Path:
    try:
        normalized_id = str(uuid.UUID(song_id))
    except ValueError as exc:
        raise ValueError("Invalid song id") from exc
    if normalized_id != song_id:
        raise ValueError("Invalid song id")

    path = SONGS_DIR / song_id
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def stored_path(path: Path) -> str:
    """Return a portable path relative to the backend data directory."""
    return path.resolve().relative_to(DATA_DIR).as_posix()


def resolve_stored_path(value: str | None) -> Path | None:
    """Resolve new relative paths and legacy absolute paths safely."""
    if not value:
        return None
    candidate = Path(value)
    resolved = candidate.resolve() if candidate.is_absolute() else (DATA_DIR / candidate).resolve()
    try:
        resolved.relative_to(DATA_DIR)
    except ValueError:
        return None
    return resolved
