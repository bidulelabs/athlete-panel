import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCANNER = Path(__file__).resolve().parents[2] / 'scripts/publication-check.py'
spec = importlib.util.spec_from_file_location('publication', SCANNER)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class PublicationChecks(unittest.TestCase):
    def test_shared_recursive_packaging_policy(self):
        root = SCANNER.parent.parent
        fixtures = json.loads((root / 'tests/fixtures/packaging.json').read_text())
        for name in fixtures['excluded']:
            self.assertIn((0, 'private-or-generated-file'), list(scanner.findings(name, b'synthetic fixture')), name)
        for name in fixtures['included'] + fixtures['required']:
            self.assertEqual(list(scanner.findings(name, b'synthetic source')), [], name)
        patterns = (root / '.dockerignore').read_text().splitlines()
        for name in scanner.PRIVATE_FILES['names']:
            self.assertIn('**/' + name, patterns)
        for suffix in scanner.PRIVATE_FILES['suffixes']:
            self.assertIn('**/*' + suffix, patterns)
        self.assertIn('**/.env*', patterns)
        self.assertIn('!**/.env.example', patterns)
        self.assertLess(patterns.index('!**/.env.example'), patterns.index('**/.secrets'))

    def test_private_files_and_sensitive_patterns_without_values(self):
        self.assertIn((0, 'private-or-generated-file'), list(scanner.findings('private-exports/context.json', b'{}')))
        self.assertEqual(list(scanner.findings('.env.example', b'ENCRYPTION_KEY=')), [])
        self.assertEqual(list(scanner.findings('packages/host/migrations/001.sql', b'create table test();')), [])
        secret = ('ghp_' + 'A' * 36).encode()
        self.assertEqual(list(scanner.findings('example.txt', secret)), [(1, 'github-token')])

    def test_index_scan_reads_staged_bytes_not_the_fixed_working_copy(self):
        with tempfile.TemporaryDirectory(prefix='athlete-panel-publication-test-') as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            secret = 'ghp_' + 'B' * 36
            (root / 'note.txt').write_text(secret)
            subprocess.run(['git', 'add', 'note.txt'], cwd=root, check=True)
            (root / 'note.txt').write_text('Corrected working copy')
            result = subprocess.run(['python3', str(SCANNER), '--staged'], cwd=root, text=True, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('github-token', result.stdout)
            self.assertNotIn(secret, result.stdout + result.stderr)
            candidate = subprocess.run(['python3', str(SCANNER), '--worktree'], cwd=root, text=True, capture_output=True)
            self.assertEqual(candidate.returncode, 0)


if __name__ == '__main__':
    unittest.main()
