#!/usr/bin/env bash
# Run against owned services and a fresh database. Dependencies must be installed.
set -euo pipefail
REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"
export DANCIFY_TEST_API_PORT="${DANCIFY_TEST_API_PORT:-8765}"
export DANCIFY_TEST_WEB_PORT="${DANCIFY_TEST_WEB_PORT:-5173}"
python3 - <<'PY'
import os, socket
ports = [int(os.environ[k]) for k in ('DANCIFY_TEST_API_PORT', 'DANCIFY_TEST_WEB_PORT')]
assert len(set(ports)) == 2 and all(1024 <= p <= 65535 for p in ports), 'Choose two distinct unprivileged ports'
for port in ports:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
PY
RUN_DIR="$(mktemp -d /tmp/dancify-web-ci.XXXXXXXX)"
api_pid=''
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  if [[ "$result" -ne 0 ]]; then
    cat "$RUN_DIR/backend.log" 2>/dev/null || true
    echo "Integration failed. Diagnostics retained at $RUN_DIR" >&2
  else
    rm -rf -- "$RUN_DIR"
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export DANCIFY_DATA_DIR="$RUN_DIR/data"
export MPLCONFIGDIR="$RUN_DIR/matplotlib"
export XDG_CACHE_HOME="$RUN_DIR/cache"
export DANCIFY_PIPELINE_PYTHON="$REPO_DIR/pipeline/.venv/bin/python"
export DANCIFY_CORS_ORIGINS="http://127.0.0.1:$DANCIFY_TEST_WEB_PORT,http://localhost:$DANCIFY_TEST_WEB_PORT"
export DANCIFY_TEST_API="http://127.0.0.1:$DANCIFY_TEST_API_PORT"
# Exercise the same browser configuration after cache isolation, before starting
# services or preparing media. Explicit browser paths/overrides remain inherited.
(cd web && CI=1 ./node_modules/.bin/playwright test --config playwright.preflight.config.ts)
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "$DANCIFY_TEST_API_PORT" >"$RUN_DIR/backend.log" 2>&1 &
api_pid=$!
ready=0
for attempt in {1..60}; do
  kill -0 "$api_pid"
  if curl -fsS "$DANCIFY_TEST_API/health" > /dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
[[ "$ready" == 1 ]]
# A short excerpt of the tracked reference fixture, with its actual music.
ffmpeg -nostdin -y -loglevel error -i pipeline/testdata/Video_1.mp4 -i pipeline/testdata/audio_1.m4a \
  -t 8 -map 0:v:0 -map 1:a:0 -vf scale=320:180 -c:v libx264 -pix_fmt yuv420p -c:a aac "$RUN_DIR/seed.mp4"
export DANCIFY_TEST_UPLOAD_VIDEO="$RUN_DIR/seed.mp4"
pipeline/.venv/bin/python backend/scripts/prepare_smoke.py --base-url "$DANCIFY_TEST_API" --video "$RUN_DIR/seed.mp4" --keep-song
# Navigation needs two distinct library entries; prepare both through the real pipeline.
cp "$RUN_DIR/seed.mp4" "$RUN_DIR/second-song.mp4"
pipeline/.venv/bin/python backend/scripts/prepare_smoke.py --base-url "$DANCIFY_TEST_API" --video "$RUN_DIR/second-song.mp4" --keep-song
cd web
# CI prevents Playwright from attaching to an unrelated existing Vite server.
CI=1 npm run test:browser -- "$@"
