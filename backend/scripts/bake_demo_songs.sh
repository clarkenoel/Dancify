#!/usr/bin/env bash
# Thin wrapper — see bake_demo_songs.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec python3 "${ROOT}/backend/scripts/bake_demo_songs.py" "$@"
