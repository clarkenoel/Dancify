#!/usr/bin/env bash
# Smoke test against a running server on :8000
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:8000}"

echo "== health =="
curl -sf "$BASE/health" | tee /tmp/dancify-health.json
echo

echo "== create song =="
SONG=$(curl -sf -X POST "$BASE/songs/json" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Smoke Test Track","source_url":"https://example.com/smoke.mp4"}')
echo "$SONG" | tee /tmp/dancify-song.json
ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$SONG")

echo "== fake chart =="
CHART=/tmp/dancify-dance.json
python3 - <<'PY'
import json
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
open("/tmp/dancify-dance.json", "w").write(json.dumps(chart))
PY

curl -sf -X PUT "$BASE/songs/$ID/chart" -F "chart=@$CHART" | tee /tmp/dancify-ready.json
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
echo "SMOKE OK"
