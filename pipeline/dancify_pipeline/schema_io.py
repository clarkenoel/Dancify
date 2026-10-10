"""Validate and write dance.json against frozen schema."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "schema" / "dance.schema.json.json"


def load_schema() -> dict[str, Any]:
    if not SCHEMA_PATH.is_file():
        raise FileNotFoundError(
            f"Schema not found at {SCHEMA_PATH} "
            "(repo uses double extension dance.schema.json.json)"
        )
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_dance(doc: dict[str, Any]) -> None:
    schema = load_schema()
    validator = Draft7Validator(schema)
    errors = sorted(validator.iter_errors(doc), key=lambda e: e.path)
    if errors:
        msgs = "; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errors[:8])
        raise ValueError(f"dance.json failed schema validation: {msgs}")


def write_dance_json(doc: dict[str, Any], path: Path) -> Path:
    validate_dance(doc)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return path
