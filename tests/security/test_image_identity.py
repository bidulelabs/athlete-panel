"""Portable identity proofs using classic and OCI/containerd-shaped fixtures."""
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import image_identity as identity


class ImageIdentity(unittest.TestCase):
    def archive(self, path, architecture='amd64', config=None, link=False):
        data = json.dumps(config or {'os': 'linux', 'architecture': architecture, 'rootfs': {'diff_ids': ['sha256:' + 'c' * 64]}}).encode()
        name = identity.digest(data)[7:] + '.json'
        with tarfile.open(path, 'w') as archive:
            for filename, value in [('manifest.json', json.dumps([{'Config': name, 'Layers': []}]).encode()), (name, data)]:
                member = tarfile.TarInfo(filename); member.size = len(value)
                if link and filename == name: member.type = tarfile.SYMTYPE; member.linkname = '/etc/passwd'
                archive.addfile(member, io.BytesIO(value))
        return identity.digest(data)

    def test_same_config_proven_across_engine_specific_identifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar'; config = self.archive(path)
            info = {'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['sha256:' + 'c' * 64]}}
            classic = identity.archive_identity(path, {**info, 'Id': config})
            containerd = identity.archive_identity(path, {**info, 'Id': 'sha256:' + 'd' * 64})
            self.assertEqual(classic, containerd)
            identity.verify(containerd, classic)
            identity.verify(containerd, None, config)
            with self.assertRaisesRegex(ValueError, 'cannot be linked'): identity.verify(containerd, None, 'sha256:' + 'e' * 64)
            with self.assertRaisesRegex(ValueError, 'platform/rootfs'): identity.archive_identity(path, {**info, 'Architecture': 'arm64'})

    def test_index_selects_platform_then_authenticates_manifest_to_config(self):
        base = {'format': 1, 'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': 'sha256:' + 'a' * 64}
        manifest = json.dumps({'schemaVersion': 2, 'config': {'digest': base['configDigest']}, 'layers': []}).encode()
        manifest_digest = identity.digest(manifest)
        index = json.dumps({'schemaVersion': 2, 'manifests': [{'digest': manifest_digest, 'platform': {'os': 'linux', 'architecture': 'amd64'}},
                            {'digest': 'sha256:' + 'b' * 64, 'platform': {'os': 'linux', 'architecture': 'arm64'}}]}).encode()
        index_digest = identity.digest(index); values = {index_digest: index, manifest_digest: manifest}; calls = []
        def run(args):
            if args[1:3] == ['buildx', 'version']: return 'synthetic buildx'
            calls.append(args); return values[args[-2].split('@')[1]].decode() + '\n'
        result = identity.registry_identity('registry.example/app@' + index_digest, base, run)
        self.assertEqual(result['manifestDigest'], manifest_digest); self.assertEqual(result['indexDigest'], index_digest)
        self.assertEqual(len(calls), 2)
        for old in [base['configDigest'], manifest_digest, index_digest]: identity.verify(result, None, old)
        with self.assertRaisesRegex(ValueError, 'configuration differs'):
            identity.registry_identity('registry.example/app@' + index_digest, {**base, 'configDigest': 'sha256:' + 'f' * 64}, run)
        values[manifest_digest] = b'{"schemaVersion":2}'
        with self.assertRaisesRegex(ValueError, 'digest verification'): identity.registry_identity('registry.example/app@' + index_digest, base, run)

    def test_ambiguous_platform_and_unsafe_archive_are_rejected(self):
        base = {'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': 'sha256:' + 'a' * 64}
        raw = json.dumps({'schemaVersion': 2, 'manifests': []}).encode()
        with self.assertRaisesRegex(ValueError, 'unique matching platform'):
            identity.registry_identity('registry.example/app@' + identity.digest(raw), base, lambda _: raw.decode())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar'; self.archive(path, link=True)
            with self.assertRaisesRegex(ValueError, 'archive member'):
                identity.archive_identity(path, {'Os': 'linux', 'Architecture': 'amd64'})

    def test_saved_oci_index_proves_legacy_id_after_loading_on_classic_store(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.tar'; config = self.archive(path)
            manifest = json.dumps({'schemaVersion': 2, 'config': {'digest': config}, 'layers': []}).encode()
            manifest_digest = identity.digest(manifest)
            index = json.dumps({'schemaVersion': 2, 'manifests': [{'digest': manifest_digest, 'platform': {'os': 'linux', 'architecture': 'amd64'}}]}).encode()
            index_digest = identity.digest(index)
            with tarfile.open(path, 'a') as archive:
                for name, value in [('index.json', json.dumps({'manifests': [{'digest': index_digest}]}).encode()),
                                    ('blobs/sha256/' + index_digest[7:], index), ('blobs/sha256/' + manifest_digest[7:], manifest)]:
                    member = tarfile.TarInfo(name); member.size = len(value); archive.addfile(member, io.BytesIO(value))
            info = {'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['sha256:' + 'c' * 64]}, 'Id': config}
            actual = identity.archive_identity(path, info)
            self.assertEqual(actual['configDigest'], config)
            self.assertEqual(actual['manifestDigest'], manifest_digest)
            self.assertEqual(actual['indexDigest'], index_digest)
            identity.verify(actual, None, index_digest)
            identity.verify(actual, None, manifest_digest)

    def test_changed_manifest_and_unknown_format_fail_even_with_same_config(self):
        base = {'format': 1, 'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': 'sha256:' + 'a' * 64, 'manifestDigest': 'sha256:' + 'b' * 64}
        with self.assertRaisesRegex(ValueError, 'manifestDigest'): identity.verify({**base, 'manifestDigest': 'sha256:' + 'c' * 64}, base)
        with self.assertRaisesRegex(ValueError, 'format'): identity.verify(base, {**base, 'format': 99})

    def test_exports_ignore_tmpdir_and_use_private_disk_scratch_then_clean_up(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'TMPDIR': root, 'ATHLETE_PANEL_IMAGE_TMPDIR': '/var/tmp'}):
            paths = []
            info = {'Id': 'sha256:' + 'a' * 64, 'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['sha256:' + 'c' * 64]}}
            def run(args):
                if args[1:3] == ['image', 'inspect']: return json.dumps([info])
                self.assertEqual(args[1:3], ['save', '-o'])  # Local verification never asks for Buildx.
                target = Path(args[3]); paths.append(target)
                self.assertEqual(target.parent.parent, Path('/var/tmp').resolve())
                self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
                self.archive(target)
                return ''
            result = identity.identify(info['Id'], run)
            self.assertEqual(result['architecture'], 'amd64')
            self.assertFalse(paths[0].parent.exists())

    def test_memory_backed_and_insufficient_disk_scratch_are_rejected(self):
        with tempfile.TemporaryDirectory(dir='/var/tmp') as root, patch.dict(os.environ, {'ATHLETE_PANEL_IMAGE_TMPDIR': root}):
            for filesystem in ['tmpfs', 'ramfs']:
                with self.subTest(filesystem=filesystem), self.assertRaisesRegex(ValueError, 'memory-backed'):
                    identity.image_scratch({}, '1 0 0:1 / / rw - ' + filesystem + ' synthetic rw')
            disk_mount = '1 0 0:1 / / rw - ext4 synthetic rw'
            with patch.object(identity.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)):
                with self.assertRaisesRegex(ValueError, 'Insufficient disk space.*MiB'):
                    identity.image_scratch({'Size': 853 * 1024 * 1024}, disk_mount)
                with patch.object(identity, 'output', return_value=json.dumps([{'Id': 'sha256:' + 'a' * 64, 'Os': 'linux'}])) as output:
                    with self.assertRaisesRegex(ValueError, 'Insufficient disk space'): identity.identify('synthetic', lambda args: '')
                    self.assertEqual(output.call_count, 1)  # No export after a failed capacity check.

    def test_export_failure_and_interruption_remove_partial_archives(self):
        for error in [RuntimeError('synthetic secret in Docker output'), KeyboardInterrupt()]:
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory(dir='/var/tmp') as root, patch.dict(os.environ, {'ATHLETE_PANEL_IMAGE_TMPDIR': root}):
                paths = []
                def run(args):
                    if args[1:3] == ['image', 'inspect']: return json.dumps([{'Id': 'sha256:' + 'a' * 64, 'Os': 'linux'}])
                    target = Path(args[3]); target.write_bytes(b'synthetic partial archive'); paths.append(target)
                    raise error
                with self.assertRaises(KeyboardInterrupt if isinstance(error, KeyboardInterrupt) else identity.ImageIdentityError) as caught:
                    identity.identify('synthetic', run)
                self.assertNotIn('synthetic secret', str(caught.exception))
                self.assertFalse(paths[0].parent.exists())

    def test_existing_archive_needs_no_scratch_export_or_buildx(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'retained.tar'; config = self.archive(path)
            info = {'Id': config, 'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['sha256:' + 'c' * 64]}}
            with patch.object(identity, 'image_scratch', side_effect=AssertionError('must reuse archive')):
                result = identity.identify(config, lambda args: json.dumps([info]), archive=path)
            self.assertEqual(result['configDigest'], config)

    def test_missing_buildx_is_actionable_and_private_for_registry_verification(self):
        base = {'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': 'sha256:' + 'a' * 64}
        for failure in [SimpleNamespace(returncode=1), RuntimeError('synthetic private command output')]:
            def run(args):
                self.assertEqual(args, ['docker', 'buildx', 'version'])
                if isinstance(failure, Exception): raise failure
                return failure
            with self.assertRaisesRegex(ValueError, 'Docker Buildx.*Install') as caught:
                identity.registry_identity('registry.example/app@sha256:' + 'b' * 64, base, run)
            self.assertNotIn('synthetic private', str(caught.exception))


if __name__ == '__main__': unittest.main()
