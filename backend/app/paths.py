from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "dancify.db"
SONGS_DIR = DATA_DIR / "songs"


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)


def song_dir(song_id: str) -> Path:
    path = SONGS_DIR / song_id
    path.mkdir(parents=True, exist_ok=True)
    return path
