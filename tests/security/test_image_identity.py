"""Portable identity proofs using classic and OCI/containerd-shaped fixtures."""
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

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


if __name__ == '__main__': unittest.main()
