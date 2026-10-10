from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .paths import DB_PATH, ensure_data_dirs


class Base(DeclarativeBase):
    pass


ensure_data_dirs()
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def configure_sqlite(dbapi_connection: object, _: object) -> None:
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    ensure_data_dirs()
    Base.metadata.create_all(bind=engine)
    migrate_sqlite(engine)


def migrate_sqlite(database_engine: Engine) -> None:
    """Add nullable cache metadata without requiring an external migration tool."""
    columns = {
        "songs": {
            "source_video_path": "VARCHAR(512)",
            "report_path": "VARCHAR(512)",
            "active_bundle_id": "VARCHAR(36)",
            "active_preparation_job_id": "VARCHAR(36)",
        },
        "plays": {
            "bundle_id": "VARCHAR(36)",
        },
        "preparation_jobs": {
            "start_time": "FLOAT",
            "end_time": "FLOAT",
        },
    }
    with database_engine.begin() as connection:
        for table, additions in columns.items():
            existing = {
                str(row[1])
                for row in connection.exec_driver_sql(
                    f"PRAGMA table_info({table})"
                ).all()
            }
            if not existing:
                continue
            for name, definition in additions.items():
                if name not in existing:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {name} {definition}"
                    )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_plays_bundle_id ON plays (bundle_id)"
        )
        connection.exec_driver_sql(
            "UPDATE songs SET source_video_path = video_path "
            "WHERE source_video_path IS NULL AND video_path IS NOT NULL"
        )
