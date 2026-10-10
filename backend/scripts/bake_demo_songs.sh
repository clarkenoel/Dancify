#!/usr/bin/env bash
# Clean-checkout wrapper — see backend/README.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_PYTHON="${BACKEND_PYTHON:-${ROOT}/backend/.venv/bin/python}"
PIPELINE_PYTHON="${PIPELINE_PYTHON:-${ROOT}/pipeline/.venv/bin/python}"

if [[ ! -x "${BACKEND_PYTHON}" ]]; then
  BACKEND_PYTHON="$(command -v python3)"
fi

exec "${BACKEND_PYTHON}" "${ROOT}/backend/scripts/bake_demo_songs.py" \
  --pipeline-python "${PIPELINE_PYTHON}" \
  "$@"
