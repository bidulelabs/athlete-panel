"""Keep the synthetic upgrade candidate complete without copying private files."""
import importlib.util
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('hosted', ROOT / 'scripts/hosted.py')
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)
spec = importlib.util.spec_from_file_location('hosted_rehearsal', ROOT / 'scripts/rehearse-hosted.py')
rehearsal = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'hosted': hosted}):
    spec.loader.exec_module(rehearsal)


class HostedCandidateSource(unittest.TestCase):
    def test_candidate_contains_docker_build_inputs_but_excludes_private_state(self):
        # Derive the requirements from the real Dockerfile, independently of the
        # rehearsal's allowlist, so future source additions cannot silently drift.
        required = set()
        for line in (ROOT / 'Dockerfile').read_text().splitlines():
            words = shlex.split(line)
            if words and words[0].upper() == 'COPY' and not any(word.startswith('--from=') for word in words):
                required.update(word for word in words[1:-1] if not word.startswith('--'))
        for name in sorted(required):
            self.assertTrue((ROOT / name).exists(), f'Docker COPY input is missing from source: {name}')
        with tempfile.TemporaryDirectory(prefix='athlete-panel-candidate-test-') as folder:
            source, candidate = Path(folder) / 'source', Path(folder) / 'candidate'
            source.mkdir()
            for name in required:
                target = source / name
                if (ROOT / name).is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    (target / 'synthetic-source.txt').write_text('synthetic source')
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text('synthetic source')
            private = ['.env', 'arbitrary-export.json', '.impeccable/config.local.json',
                       'docs/context.json', 'docs/.env.production', 'docs/private-exports/record.json',
                       'apps/web/.next/cache', 'packages/ui/node_modules/example/index.js']
            for name in private:
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('synthetic private fixture')
            with patch.object(rehearsal, 'ROOT', source):
                rehearsal.copy_candidate(candidate)
            self.assertEqual(sorted(name for name in required if not (candidate / name).exists()), [])
            self.assertEqual(sorted(name for name in private if (candidate / name).exists()), [])
            self.assertEqual((candidate / '.env.example').read_text(), 'synthetic source')


if __name__ == '__main__':
    unittest.main()
