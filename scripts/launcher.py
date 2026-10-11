#!/usr/bin/env python3
"""Local development supervisor. Uses only Python's standard library."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class LaunchError(Exception):
    pass


def check_command(command, description, cwd=ROOT):
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LaunchError(f'{description} unavailable. Run bash scripts/setup.sh. ({exc})') from exc
    if result.returncode:
        raise LaunchError(f'{description} check failed. Run bash scripts/setup.sh.\n{result.stderr[-1500:]}')
    return result.stdout.strip()


def preflight(root=ROOT):
    for name in ('node', 'npm', 'ffmpeg', 'ffprobe'):
        if not shutil.which(name):
            raise LaunchError(f'Missing {name}. See LAUNCHER.md; then run bash scripts/setup.sh.')
    version = check_command(['node', '-p', 'process.versions.node'], 'Node')
    if tuple(map(int, version.split('.')[:2])) < (22, 12):
        raise LaunchError('Node >=22.12 is required. Run nvm install 22, then bash scripts/setup.sh.')
    check_command([str(root / 'backend/.venv/bin/python'), '-c',
                   'import fastapi, uvicorn, sqlalchemy, multipart, jsonschema'], 'Backend environment')
    check_command([str(root / 'pipeline/.venv/bin/python'), '-c',
                   'import mediapipe, librosa, cv2, soundfile, scipy, yt_dlp'], 'Pipeline environment')
    if not (root / 'web/node_modules/vite/bin/vite.js').is_file():
        raise LaunchError('Frontend dependencies are missing. Run bash scripts/setup.sh.')
    # Repository-supported offline asset copy also verifies the model hash.
    check_command(['node', str(root / 'web/scripts/setup-models.mjs')], 'Pose model', root / 'web')


def ensure_free(port):
    # Reject existing listeners rather than attach to a service with unknown data/config.
    for family, address in ((socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((address, port))
        except OSError as exc:
            if family == socket.AF_INET6 and exc.errno in (97, 99):
                continue
            raise LaunchError(f'Port {port} is already in use. Stop the previous Dancify server in its terminal, or choose another backend port with --api-port. No existing process was stopped.') from exc


def request(url):
    with OPENER.open(url, timeout=1) as response:
        return response.read()


def wait_ready(process, url, kind, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LaunchError(f'{kind} exited during startup (code {process.returncode}). See its log.')
        try:
            body = request(url)
            if kind == 'Backend':
                health = json.loads(body)
                if health.get('ok') is True and health.get('service') == 'dancify-song-cache':
                    return
            elif b'/src/main.tsx' in body:
                return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise LaunchError(f'{kind} did not become ready within {timeout}s. See its log.')


def stop(process):
    # Each child owns a new process group; never kill by executable name or port.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def open_browser(url):
    try:
        if shutil.which('cmd.exe'):
            subprocess.run(['cmd.exe', '/c', 'start', '', url], cwd='/tmp',
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=True)
        else:
            import webbrowser
            if not webbrowser.open(url):
                print(f'Open {url} in your browser.', flush=True)
    except (OSError, subprocess.SubprocessError):
        print(f'Could not open the browser automatically. Open {url} manually.', flush=True)


def port_number(value):
    port = int(value)
    if not 1024 <= port <= 65535 or port == 5173:
        raise argparse.ArgumentTypeError('Choose a backend port from 1024–65535 other than 5173.')
    return port


def main(argv=None):
    parser = argparse.ArgumentParser(description='Start Dancify locally; Ctrl+C stops its services.')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--api-port', type=port_number, default=8000)
    args = parser.parse_args(argv)
    state = ROOT / '.launcher'
    state.mkdir(exist_ok=True)
    children, logs = [], []
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    inherited = os.environ.pop('DANCIFY_LAUNCH_LOCK_FD', None)
    lock_file = os.fdopen(int(inherited), 'a') if inherited else (state / 'launcher.lock').open('a')
    with lock_file as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Dancify launcher is already running for this checkout. Use its existing window; no duplicate services were started.', flush=True)
            return 0
        try:
            print('Checking Dancify dependencies…', flush=True)
            preflight()
            ensure_free(args.api_port)
            ensure_free(5173)
            env = os.environ.copy()
            env['VITE_DANCIFY_API_URL'] = f'http://127.0.0.1:{args.api_port}'
            env['DANCIFY_PIPELINE_PYTHON'] = str(ROOT / 'pipeline/.venv/bin/python')
            # This launcher always serves the known local frontend origin.
            env['DANCIFY_CORS_ORIGINS'] = 'http://localhost:5173,http://127.0.0.1:5173'
            folder = state / f'run-{time.time_ns()}'
            folder.mkdir()
            print(f'Logs: {folder}', flush=True)
            commands = [
                ('Backend', [str(ROOT / 'backend/.venv/bin/python'), '-m', 'uvicorn', 'app.main:app', '--app-dir', str(ROOT / 'backend'), '--host', '127.0.0.1', '--port', str(args.api_port)], ROOT, f'http://127.0.0.1:{args.api_port}/health'),
                ('Frontend', ['node', str(ROOT / 'web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], ROOT / 'web', 'http://127.0.0.1:5173/'),
            ]
            for label, command, cwd, url in commands:
                print(f'Starting {label.lower()}…', flush=True)
                log = (folder / f'{label.lower()}.log').open('w')
                logs.append(log)
                child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(child)
                wait_ready(child, url, label)
            # Verify the actual library route, not just an open socket or health endpoint.
            if not isinstance(json.loads(request(f'http://127.0.0.1:{args.api_port}/songs')), list):
                raise LaunchError('Song service returned an unexpected response.')
            print('Ready: http://127.0.0.1:5173\nKeep this window open. Press Ctrl+C to stop Dancify.', flush=True)
            if not args.no_browser:
                open_browser('http://127.0.0.1:5173')
            while True:
                for child, (label, *_) in zip(children, commands):
                    if child.poll() is not None:
                        raise LaunchError(f'{label} stopped unexpectedly (code {child.returncode}). See {folder}.')
                time.sleep(0.4)
        except KeyboardInterrupt:
            print('\nStopping Dancify…', flush=True)
            return 0
        except (LaunchError, OSError, ValueError, urllib.error.URLError) as exc:
            print(f'Dancify could not continue: {exc}', file=sys.stderr, flush=True)
            return 1
        finally:
            # A second Ctrl+C must not interrupt cleanup and leave servers orphaned.
            for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                signal.signal(sig, signal.SIG_IGN)
            for child in reversed(children):
                stop(child)
            for log in logs:
                log.close()


if __name__ == '__main__':
    sys.exit(main())
