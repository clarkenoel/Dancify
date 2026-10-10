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
printf 'smoke-video' > "$TMP/video.mp4"
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
    "keyframe_landmarks": [[0.0, 0.0, 0.0, 1.0]] * 33,
    "is_hold": False,
  }],
}
open(sys.argv[1], "w").write(json.dumps(chart))
PY
printf 'smoke-audio' > "$TMP/audio.wav"

curl -sf -X PUT "$BASE/songs/$ID/chart" \
  -F "chart=@$CHART" \
  -F "audio=@$TMP/audio.wav" \
  | tee /tmp/dancify-ready.json
echo

echo "== fetch chart =="
curl -sf "$BASE/songs/$ID/chart" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]=="1.0"; print("chart ok", d["bpm"], "moves", len(d["moves"]))'

echo "== record play =="
curl -sf -X POST "$BASE/songs/$ID/plays" \
  -H 'Content-Type: application/json' \
  -d '{"player_name":"smoke","score":100,"accuracy":1.0,"max_combo":1,"judgments":{"PERFECT":1}}' \
  | tee /tmp/dancify-play.json
echo

echo "== history =="
curl -sf "$BASE/songs/$ID/plays" | python3 -c 'import json,sys; print("plays", len(json.load(sys.stdin)))'

echo "== cleanup =="
curl -sf -X DELETE "$BASE/songs/$ID" -o /dev/null -w "deleted %{http_code}\n"
ID=""
echo "SMOKE OK"
