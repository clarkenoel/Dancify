#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p .launcher
if [[ -n "${DANCIFY_SETUP_LOCK_FD:-}" ]]; then
  # demo.py passes an already-locked open file description to this subprocess.
  lock_fd="$DANCIFY_SETUP_LOCK_FD"
else
  exec 9>.launcher/launcher.lock
  lock_fd=9
fi
if ! flock -n "$lock_fd"; then
  echo 'Close the running launcher/setup before installing dependencies.' >&2
  exit 1
fi
trap 'echo "Setup did not finish. Fix the error above and run bash scripts/setup.sh again. Your songs and settings were preserved." >&2' ERR
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  source "$NVM_DIR/nvm.sh"
fi
for tool in python3 node npm ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool. Follow LAUNCHER.md system prerequisites, then rerun setup." >&2
    exit 1
  fi
done
python3 -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,12), "Python 3.10–3.12 is required (Ubuntu 24.04 recommended)"'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<12)) { console.error("Node >=22.12 required; run nvm install 22"); process.exit(1); }'
echo 'Installing backend dependencies…'
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
backend/.venv/bin/python -m pip check
echo 'Installing video preparation dependencies…'
python3 -m venv pipeline/.venv
pipeline/.venv/bin/python -m pip install -r pipeline/requirements-dev.txt
pipeline/.venv/bin/python -m pip check
echo 'Installing frontend and verifying local model…'
(cd web && npm ci --no-audit --no-fund && npm run build)
echo 'Setup complete. Double-click Start Dancify.cmd, or run bash scripts/start.sh.'
