import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'demo.py'
spec = importlib.util.spec_from_file_location('demo', SOURCE)
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.origin = self.base / 'origin'
        self.checkout = self.base / 'demo'
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(self.origin)], check=True)
        self.git(self.origin, 'config', 'user.email', 'test@example.invalid')
        self.git(self.origin, 'config', 'user.name', 'Test')
        (self.origin / '.gitignore').write_text('.launcher/\nbackend/data/\nweb/.env.local\n')
        (self.origin / 'version').write_text('one')
        self.git(self.origin, 'add', '.')
        self.git(self.origin, 'commit', '-qm', 'one')
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.checkout)], check=True)

    def git(self, root, *args):
        return demo.git(root, *args)

    def advance(self):
        (self.origin / 'version').write_text('two')
        self.git(self.origin, 'commit', '-qam', 'two')
        return self.git(self.origin, 'rev-parse', 'HEAD')

    def test_updates_to_main_and_preserves_ignored_data(self):
        data = self.checkout / 'backend/data'
        data.mkdir(parents=True)
        (data / 'songs.db').write_text('preserve')
        target = self.advance()
        self.assertEqual(demo.update_checkout(self.checkout), target)
        self.assertEqual((self.checkout / 'version').read_text(), 'two')
        self.assertEqual((data / 'songs.db').read_text(), 'preserve')
        self.assertEqual(demo.update_checkout(self.checkout), target)

    def test_rejects_dirty_or_untracked_files(self):
        self.advance()
        for name in ['version', 'untracked']:
            path = self.checkout / name
            path.write_text('local work')
            with self.assertRaisesRegex(RuntimeError, 'Local changes'):
                demo.update_checkout(self.checkout)
            self.assertEqual(path.read_text(), 'local work')
            if name == 'version': self.git(self.checkout, 'restore', 'version')

    def test_rejects_feature_branch(self):
        self.git(self.checkout, 'switch', '-c', 'feature')
        with self.assertRaisesRegex(RuntimeError, 'main branch'):
            demo.update_checkout(self.checkout)
        self.assertEqual(self.git(self.checkout, 'branch', '--show-current'), 'feature')

    def test_rejects_local_commits_even_when_ahead(self):
        self.git(self.checkout, 'config', 'user.email', 'test@example.invalid')
        self.git(self.checkout, 'config', 'user.name', 'Test')
        (self.checkout / 'version').write_text('local work')
        self.git(self.checkout, 'commit', '-qam', 'local')
        head = self.git(self.checkout, 'rev-parse', 'HEAD')
        with self.assertRaises(RuntimeError): demo.update_checkout(self.checkout)
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), head)

    def test_offline_fetch_does_not_move_head(self):
        head = self.git(self.checkout, 'rev-parse', 'HEAD')
        self.git(self.checkout, 'remote', 'set-url', 'origin', str(self.base / 'missing'))
        with self.assertRaises(RuntimeError): demo.update_checkout(self.checkout)
        self.assertEqual(self.git(self.checkout, 'rev-parse', 'HEAD'), head)

    def test_running_launcher_blocks_update(self):
        import fcntl
        state = self.checkout / '.launcher'
        state.mkdir()
        with (state / 'launcher.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(demo, 'ROOT', self.checkout), patch.object(demo, 'update_checkout') as update:
                self.assertEqual(demo.main(), 1)
                update.assert_not_called()

    def run_demo(self, setup_exit=0):
        scripts = self.origin / 'scripts'
        scripts.mkdir()
        # Each subprocess must observe the supervisor's lock still held.
        check = 'if flock -n .launcher/launcher.lock -c true; then exit 91; fi\n'
        (scripts / 'setup.sh').write_text('#!/bin/bash\nset -eu\n' + check + f'echo setup > .launcher/setup-called\nexit {setup_exit}\n')
        (scripts / 'start.sh').write_text('#!/bin/bash\nset -eu\n' + check + 'echo started > .launcher/start-called\n')
        self.git(self.origin, 'add', '.')
        self.git(self.origin, 'commit', '-qm', 'launcher fixture')
        import sys
        code = 'import importlib.util, pathlib, sys; s=importlib.util.spec_from_file_location("demo",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.ROOT=pathlib.Path(sys.argv[2]); sys.argv=[sys.argv[0]]; sys.exit(m.main())'
        return subprocess.run([sys.executable, '-c', code, str(SOURCE), str(self.checkout)], capture_output=True, text=True, timeout=15)

    def test_setup_and_exec_keep_lock_and_record_prepared_revision(self):
        result = self.run_demo()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.checkout / '.launcher/start-called').exists())
        self.assertEqual((self.checkout / '.launcher/demo-prepared-revision').read_text().strip(), self.git(self.checkout, 'rev-parse', 'HEAD'))

    def test_failed_setup_never_starts_or_marks_revision_prepared(self):
        result = self.run_demo(setup_exit=7)
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.checkout / '.launcher/start-called').exists())
        self.assertFalse((self.checkout / '.launcher/demo-prepared-revision').exists())
