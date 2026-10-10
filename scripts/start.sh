#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Windows launches a noninteractive shell, which normally does not load nvm.
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  source "$NVM_DIR/nvm.sh"
fi
if ! command -v python3 >/dev/null; then
  echo 'Python 3 is missing. Follow LAUNCHER.md first-time setup.' >&2
  exit 1
fi
exec python3 "$ROOT/scripts/launcher.py" "$@"
