#!/usr/bin/env python3
"""Update a clean main checkout, prepare it, then launch the latest code."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(root, *args):
    result = subprocess.run(['git', *args], cwd=root, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Git operation failed.')
    return result.stdout.strip()


def update_checkout(root):
    if git(root, 'branch', '--show-current') != 'main':
        raise RuntimeError('Latest demo requires the main branch. Use the regular launcher for feature branches. See LAUNCHER.md for the one-time switch.')
    if git(root, 'status', '--porcelain'):
        raise RuntimeError('Local changes found. Commit or move them before updating. No edits were discarded.')
    git(root, 'fetch', 'origin', 'main')
    target = git(root, 'rev-parse', 'FETCH_HEAD')
    # Even a locally-ahead main is refused: a demo must correspond to published main.
    git(root, 'merge-base', '--is-ancestor', 'HEAD', target)
    git(root, 'merge', '--ff-only', target)
    return target


def main():
    state = ROOT / '.launcher'
    state.mkdir(exist_ok=True)
    try:
        with (state / 'launcher.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Close the running launcher/setup before updating the demo.')
            print('Checking published main for updates…', flush=True)
            target = update_checkout(ROOT)
            marker = state / 'demo-prepared-revision'
            if not marker.exists() or marker.read_text().strip() != target:
                print('Preparing dependencies for this revision…', flush=True)
                env = os.environ.copy()
                env['DANCIFY_SETUP_LOCK_FD'] = str(lock.fileno())
                subprocess.run(['bash', 'scripts/setup.sh'], cwd=ROOT, env=env,
                               pass_fds=(lock.fileno(),), check=True)
                marker.write_text(target + '\n')
            print(f'Starting main at {target[:12]}', flush=True)
            # Hand the same lock to the new launcher. No update/start race and no
            # stale Python modules after updating the launcher itself.
            os.set_inheritable(lock.fileno(), True)
            os.environ['DANCIFY_LAUNCH_LOCK_FD'] = str(lock.fileno())
            os.chdir(ROOT)
            os.execvp('bash', ['bash', str(ROOT / 'scripts/start.sh'), *sys.argv[1:]])
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f'Demo update stopped: {exc}\nYour songs and local settings were preserved. The regular launcher can run the installed checkout offline.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Demo update cancelled.', file=sys.stderr)
        return 130


if __name__ == '__main__':
    sys.exit(main())
