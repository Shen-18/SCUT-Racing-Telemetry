"""Dependency guard regression tests: temporary fixtures, never mutate the live repo."""
import importlib.util
from pathlib import Path
import tempfile
import shutil
import json
import unittest

SPEC = importlib.util.spec_from_file_location('guard', Path(__file__).parents[1] / 'verify_dependencies.py')
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

class GuardTests(unittest.TestCase):
    def test_forbidden_reverse_edge_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            core = root / 'crates/telemetry-core'
            core.mkdir(parents=True)
            (core / 'Cargo.toml').write_text('[package]\nname="telemetry-core"\nversion="0.1.0"\n[dependencies]\naim-ffi={path="../aim-ffi"}\n')
            errors = guard.check_manifest(root, core / 'Cargo.toml', {}, {'telemetry-core': []}, {})
            self.assertTrue(any('forbidden edge' in e for e in errors), errors)

    def fixture(self, tmp):
        root = Path(tmp)
        repo = Path(__file__).resolve().parents[3]
        for folder in ('crates', 'src-tauri', 'config/contracts', 'tests/golden-tests', 'src'):
            shutil.copytree(repo / folder, root / folder)
        for name in ('Cargo.toml', 'package.json'):
            shutil.copy2(repo / name, root / name)
        return root

    def test_clean_repository(self):
        self.assertEqual(guard.verify(Path(__file__).resolve().parents[3]), [])

    def test_mutations_are_rejected(self):
        cases = [
            ('crates/telemetry-core/Cargo.toml', '\nreqwest = "0.12"\n', 'not allowlisted'),
            ('crates/telemetry-core/Cargo.toml', '\ntauri.workspace=true\n', 'desktop dependency'),
            ('crates/cache-core/Cargo.toml', '\ntelemetry-ipc={path="../telemetry-ipc"}\n', 'forbidden edge'),
            ('crates/telemetry-core/Cargo.toml', '\n[target.\'cfg(windows)\'.build-dependencies]\nevil={package="aim-ffi",path="../aim-ffi"}\n', 'forbidden edge'),
            ('src-tauri/Cargo.toml', '\nreqwest="0.12"\n', 'not allowlisted'),
            ('crates/csv-parser/Cargo.toml', '\nserde="1"\n', 'inherit workspace'),
        ]
        for file, injection, expected in cases:
            with self.subTest(file=file, injection=injection), tempfile.TemporaryDirectory() as tmp:
                root = self.fixture(tmp)
                with (root / file).open('a') as stream:
                    stream.write(injection)
                errors = guard.verify(root)
                self.assertTrue(any(expected in error for error in errors), errors)
                print(f'BLOCKED: {file}: {expected}')

    def test_frontend_and_root_mutations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.fixture(tmp)
            pkg = json.loads((root / 'package.json').read_text())
            pkg['optionalDependencies'] = {'unapproved-package': '1'}
            (root / 'package.json').write_text(json.dumps(pkg))
            self.assertTrue(any('frontend dependency' in e for e in guard.verify(root)))
            with (root / 'Cargo.toml').open('a') as stream:
                stream.write('\nreqwest="0.12"\n')
            self.assertTrue(any('workspace: dependency' in e for e in guard.verify(root)))
            (root / 'src/illegal.ts').write_text('import {invoke} from "@tauri-apps/api/core";')
            self.assertTrue(any('IPC outside' in e for e in guard.verify(root)))

    def test_tauri_major_minor_version_mismatch_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.fixture(tmp)
            (root / 'Cargo.lock').write_text('[[package]]\nname = "tauri"\nversion = "2.11.5"\n')
            pkg = json.loads((root / 'package.json').read_text())
            pkg['dependencies']['@tauri-apps/api'] = '2.0.0'
            (root / 'package.json').write_text(json.dumps(pkg))
            errors = guard.verify(root)
            self.assertTrue(any('Tauri major/minor version mismatch' in e for e in errors), errors)

if __name__ == '__main__':
    unittest.main(verbosity=2)
