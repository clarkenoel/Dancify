#!/usr/bin/env bash
# Smoke test against a running server on :8000
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:8000}"
TMP=$(mktemp -d)
ID=""

cleanup() {
  if [[ -n "$ID" ]]; then
    curl -sf -X DELETE "$BASE/songs/$ID" -o /dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "== health =="
curl -sf "$BASE/health" | tee /tmp/dancify-health.json
echo

echo "== create song =="
SONG=$(curl -sf -X POST "$BASE/songs/json" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Test Track","source_url":"https://example.com/smoke.mp4"}')
echo "$SONG" | tee /tmp/dancify-song.json
ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$SONG")

echo "== reference video =="
ffmpeg -nostdin -loglevel error -y \
  -f lavfi -i 'color=c=black:s=160x90:r=10:d=4' \
  -f lavfi -i 'sine=frequency=440:sample_rate=22050:duration=4' \
  -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p \
  -c:a aac -movflags +faststart -shortest "$TMP/video.mp4"
curl -sf -X POST "$BASE/songs/$ID/video" \
  -F "video=@$TMP/video.mp4" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["has_video"]'

echo "== fake chart =="
CHART="$TMP/dance.json"
python3 - "$CHART" <<'PY'
import json
import sys

chart = {
  "version": "1.0",
  "bpm": 120.0,
  "beat_times": [0.5, 1.0, 1.5, 2.0],
  "duration": 4.0,
  "moves": [{
    "id": "m0",
    "start": 1.0,
    "end": 2.0,
    "keyframe_landmarks": [[0.0, 0.0, 0.0, 0.1] for _ in range(33)],
    "is_hold": False,
  }],
}
geometry = {
    11: (-0.5, -1.0, 0.0), 12: (0.5, -1.0, 0.0),
    13: (-0.8, -0.5, 0.0), 14: (0.8, -0.5, 0.0),
    15: (-1.0, 0.0, 0.0), 16: (1.0, 0.0, 0.0),
    23: (-0.25, 0.0, 0.0), 24: (0.25, 0.0, 0.0),
    25: (-0.3, 0.8, 0.0), 26: (0.3, 0.8, 0.0),
    27: (-0.3, 1.6, 0.0), 28: (0.3, 1.6, 0.0),
}
for index, coordinates in geometry.items():
    chart["moves"][0]["keyframe_landmarks"][index] = [*coordinates, 0.95]
open(sys.argv[1], "w").write(json.dumps(chart))
PY
ffmpeg -nostdin -loglevel error -y -i "$TMP/video.mp4" \
  -map 0:a:0 -c:a pcm_s16le "$TMP/audio.wav"
printf '{"version":"1.0","status":"ready","smoke":true}\n' > "$TMP/dance.report.json"

READY=$(curl -sf -X PUT "$BASE/songs/$ID/chart" \
  -F "chart=@$CHART" \
  -F "audio=@$TMP/audio.wav" \
  -F "report=@$TMP/dance.report.json")
echo "$READY" | tee /tmp/dancify-ready.json
BUNDLE=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["active_bundle_id"])' <<<"$READY")
echo

echo "== fetch chart =="
curl -sf "$BASE/songs/$ID/chart" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]=="1.0"; print("chart ok", d["bpm"], "moves", len(d["moves"]))'
curl -sf "$BASE/songs/$ID/bundles/$BUNDLE/report" | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["cache"]["bundle_id"]; print("report ok")'

echo "== record play =="
curl -sf -X POST "$BASE/songs/$ID/plays" \
  -H 'Content-Type: application/json' \
  -d '{"player_name":"smoke","score":100,"accuracy":1.0,"max_combo":1,"judgments":{"PERFECT":1}}' \
  | tee /tmp/dancify-play.json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["bundle_id"]; print(json.dumps(d))'
echo

echo "== history =="
curl -sf "$BASE/songs/$ID/plays" | python3 -c 'import json,sys; print("plays", len(json.load(sys.stdin)))'

echo "== cleanup =="
curl -sf -X DELETE "$BASE/songs/$ID" -o /dev/null -w "deleted %{http_code}\n"
ID=""
echo "SMOKE OK"
