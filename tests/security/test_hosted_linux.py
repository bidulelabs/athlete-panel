"""OS-level regression checks; all cleanup rules target disposable fixture paths."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import hosted
import hosted_adoption as adoption
import image_identity


@unittest.skipUnless(sys.platform == 'linux', 'Linux filesystem checks')
class LinuxPrerequisites(unittest.TestCase):
    @unittest.skipUnless(shutil.which('systemd-tmpfiles'), 'systemd-tmpfiles required')
    def test_tmpfiles_cleanup_cannot_remove_migrated_ownership(self):
        with tempfile.TemporaryDirectory(prefix='athlete-panel-tmpfiles-', dir='/var/tmp') as root:
            state = Path(root) / 'state'
            name = 'athlete-panel-controller-' + adoption.fingerprint({'daemon': 'fixture', 'project': 'fixture'})
            legacy = hosted.private_directory(Path(root) / 'legacy' / name)
            hosted.write_json(legacy / 'owner.json', {'version': 1, 'state': str(state), 'daemon': 'fixture', 'project': 'fixture'})
            with adoption.project_lock('fixture', 'fixture', state, root=root) as permanent: pass
            rules = Path(root) / 'fixture.conf'
            rules.write_text('d ' + str(legacy.parent) + ' 0700 - - 1s\n')
            time.sleep(2)
            subprocess.run(['systemd-tmpfiles', '--clean', str(rules)], check=True, capture_output=True)
            self.assertFalse((legacy / 'owner.json').exists())
            self.assertTrue((permanent / 'owner.json').is_file())
            with adoption.project_lock('fixture', 'fixture', state, root=root): pass

    def test_image_export_uses_disk_with_a_memory_backed_tmpdir(self):
        if not Path('/dev/shm').is_dir(): self.skipTest('memory-backed /dev/shm required')
        with patch.dict(os.environ, {'ATHLETE_PANEL_IMAGE_TMPDIR': '/dev/shm'}):
            with self.assertRaisesRegex(ValueError, 'memory-backed'): image_identity.image_scratch({})
        with patch.dict(os.environ, {'TMPDIR': '/dev/shm', 'ATHLETE_PANEL_IMAGE_TMPDIR': '/var/tmp'}):
            config = json.dumps({'os': 'linux', 'architecture': 'amd64', 'rootfs': {'diff_ids': []}}).encode()
            config_digest = image_identity.digest(config)
            info = {'Id': config_digest, 'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': []}, 'Size': 16 * 1024 * 1024}
            paths = []
            def run(args):
                if args[1:3] == ['image', 'inspect']: return json.dumps([info])
                target = Path(args[3]); paths.append(target)
                with tarfile.open(target, 'w') as archive:
                    for name, data in [('layer.tar', bytes(info['Size'])), ('config.json', config),
                                       ('manifest.json', json.dumps([{'Config': 'config.json'}]).encode())]:
                        member = tarfile.TarInfo(name); member.size = len(data)
                        archive.addfile(member, io.BytesIO(data))
                return ''
            self.assertEqual(image_identity.identify(config_digest, run)['configDigest'], config_digest)
            self.assertEqual(paths[0].parent.parent, Path('/var/tmp'))
            self.assertFalse(paths[0].parent.exists())


if __name__ == '__main__': unittest.main()
