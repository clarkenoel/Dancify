from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import bake_demo_songs as bake


def song(song_id: str, title: str) -> dict[str, object]:
    return {
        "id": song_id,
        "title": title,
        "status": "ready",
        "has_video": True,
        "has_chart": True,
        "has_audio": True,
        "play_count": 2,
    }


def test_mandatory_demo_uses_canonical_tracked_assets() -> None:
    assert bake.MANDATORY.video == bake.ROOT / "pipeline/testdata/Video_1.mp4"
    assert bake.MANDATORY.audio_sidecar == (
        bake.ROOT / "pipeline/testdata/audio_1.m4a"
    )
    assert bake.MANDATORY.required is True
    assert bake.MANDATORY.start_time == 0.0
    assert bake.MANDATORY.end_time == 59.5


def test_manifest_identity_wins_over_title_fallback() -> None:
    recorded = song("recorded", "Renamed by a user")
    same_title = song("title-match", bake.MANDATORY.title)
    manifest = {"songs": [{"key": bake.MANDATORY.key, "id": "recorded"}]}

    selected = bake._select_existing_song(
        [same_title, recorded],
        manifest,
        bake.MANDATORY,
    )

    assert selected == recorded


def test_title_fallback_reuses_identity_when_manifest_is_missing() -> None:
    existing = song("existing", bake.MANDATORY.title)

    selected = bake._select_existing_song([existing], {}, bake.MANDATORY)

    assert selected == existing


def test_ambiguous_title_fallback_fails_without_deleting_any_song() -> None:
    matches = [
        song("first", bake.MANDATORY.title),
        song("second", bake.MANDATORY.title),
    ]

    with pytest.raises(RuntimeError, match="Multiple songs"):
        bake._select_existing_song(matches, {}, bake.MANDATORY)


def test_json_outputs_replace_atomically(tmp_path: Path) -> None:
    destination = tmp_path / "nested" / "result.json"
    destination.parent.mkdir()
    destination.write_text('{"old": true}\n', encoding="utf-8")

    bake._write_json_atomic(destination, {"status": "ok", "songs": [1]})

    assert json.loads(destination.read_text(encoding="utf-8")) == {
        "status": "ok",
        "songs": [1],
    }
    assert list(destination.parent.glob(".*.tmp")) == []
