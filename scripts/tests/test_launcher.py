import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'launcher.py'
spec = importlib.util.spec_from_file_location('launcher', SOURCE)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

# Exercise actual process groups, locks and signals, substituting only services
# and dependency checks. Separate real API/browser integration covers application readiness.
HARNESS = r'''
import importlib.util, pathlib, subprocess, sys, time
spec=importlib.util.spec_from_file_location('launcher',sys.argv[1])
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.ROOT=pathlib.Path(sys.argv[2]); m.preflight=lambda:None; m.ensure_free=lambda port:None
m.request=lambda url:b'[]'
real_popen=subprocess.Popen
mode=sys.argv[3]
count=0
def spawn(command, **kwargs):
    global count
    count+=1
    code='import os,time; print(os.getpid(),flush=True); time.sleep(120)'
    if mode=='crash' and count==1: code='import os,time; print(os.getpid(),flush=True); time.sleep(1); raise SystemExit(7)'
    kwargs['cwd']=m.ROOT
    p=real_popen([sys.executable,'-c',code],**kwargs)
    with (m.ROOT/'pids').open('a') as f:f.write(str(p.pid)+'\n')
    return p
m.subprocess.Popen=spawn
def ready(*args):
    if mode=='startup-failure' and count==2: raise m.LaunchError('readiness failed')
m.wait_ready=ready
sys.exit(m.main(['--no-browser']))
'''


class LauncherTests(unittest.TestCase):
    def test_windows_shell_payload_treats_paths_as_data(self):
        import base64
        ps = (SOURCE.parent / 'windows-launcher.ps1').read_text()
        template = ps.split("$script = @'\n", 1)[1].split("\n'@", 1)[0]
        with tempfile.TemporaryDirectory(prefix='dancify windows ') as directory:
            root = Path(directory) / 'repo $(touch INJECTED)'
            (root / 'scripts').mkdir(parents=True)
            for name in ('start.sh', 'setup.sh'):
                (root / 'scripts' / name).touch()
            encoded = base64.b64encode(str(root).encode()).decode()
            script = template.replace('__REPO__', encoded).replace('__ACTION__', 'pwd')
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True, cwd=directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), str(root))
            self.assertFalse((Path(directory) / 'INJECTED').exists())
            encoded = base64.b64encode(b'~/repo $(touch INJECTED)').decode()
            result = subprocess.run(['bash', '-c', template.replace('__REPO__', encoded).replace('__ACTION__', 'pwd')], capture_output=True, text=True, env={**os.environ, 'HOME': directory})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), str(root))

    def test_occupied_port_is_rejected_without_closing_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(launcher.LaunchError, 'already in use'):
                launcher.ensure_free(port)
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass

    def test_missing_dependency_is_actionable(self):
        with patch.object(launcher.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(launcher.LaunchError, 'Missing node'):
                launcher.preflight()

    def test_readiness_requires_correct_service_and_handles_early_exit(self):
        class Exited:
            returncode = 8
            def poll(self): return 8
        with self.assertRaisesRegex(launcher.LaunchError, 'exited during startup'):
            launcher.wait_ready(Exited(), 'unused', 'Backend')
        class Running:
            def poll(self): return None
        with patch.object(launcher, 'request', return_value=b'{"ok":true,"service":"other"}'):
            with self.assertRaisesRegex(launcher.LaunchError, 'did not become ready'):
                launcher.wait_ready(Running(), 'unused', 'Backend', timeout=0.01)

    def run_case(self, mode, signum=signal.SIGTERM):
        with tempfile.TemporaryDirectory(prefix='dancify test ') as directory:
            root = Path(directory)
            (root / 'web').mkdir()
            output = root / 'supervisor.log'
            with output.open('w') as log:
                process = subprocess.Popen([sys.executable, '-c', HARNESS, str(SOURCE), directory, mode], stdout=log, stderr=log)
                unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])
                try:
                    if mode == 'normal':
                        deadline = time.monotonic() + 8
                        while 'Ready:' not in output.read_text() and process.poll() is None and time.monotonic() < deadline:
                            time.sleep(0.05)
                        self.assertIn('Ready:', output.read_text())
                        duplicate = subprocess.run([sys.executable, '-c', HARNESS, str(SOURCE), directory, 'normal'], capture_output=True, text=True, timeout=5)
                        self.assertEqual(duplicate.returncode, 0)
                        self.assertIn('already running', duplicate.stdout)
                        process.send_signal(signum)
                    self.assertEqual(process.wait(timeout=20), 0 if mode == 'normal' else 1, output.read_text())
                    pids = [int(p) for p in (root / 'pids').read_text().splitlines()]
                    self.assertEqual(len(pids), 2)
                    for pid in pids:
                        with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
                    self.assertIsNone(unrelated.poll())
                finally:
                    if process.poll() is None:
                        process.kill(); process.wait()
                    unrelated.terminate(); unrelated.wait()

    def test_shutdown_duplicate_launch_and_ownership(self):
        self.run_case('normal')

    def test_terminal_hangup_stops_owned_services(self):
        self.run_case('normal', signal.SIGHUP)

    def test_crash_stops_sibling(self):
        self.run_case('crash')

    def test_partial_startup_cleans_up_both_children(self):
        self.run_case('startup-failure')


if __name__ == '__main__': unittest.main()
