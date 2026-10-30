"""Synthetic inspection, ownership, interruption and preservation boundaries."""
from contextlib import ExitStack
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import hosted
import hosted_adoption as adoption
import image_identity

IMAGE = 'sha256:' + 'a' * 64
IDENTITY = {'format': 1, 'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': IMAGE}


class Fixture:
    def __init__(self, root, ingress='external'):
        self.root = Path(root); self.commands = []
        self.inputs = {'project': 'training-a', 'directory': root, 'context': 'fixture', 'ingress': ingress,
                       'files': [root + '/compose.json', root + '/override.json'], 'envFiles': [root + '/app.env'],
                       'roles': {'web': 'ui', 'worker': 'jobs', 'db': 'postgres', 'backup': 'archives'}}
        self.roles = {role: self.inputs['roles'].get(role, role) for role in adoption.ROLES}
        if ingress == 'caddy': self.roles['caddy'] = 'caddy'
        for name in ['compose.json', 'override.json', 'app.env', 'key', 'policy.json']:
            hosted.write_json(self.root / name, {})
        (self.root / 'key').write_text('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
        self.storage = self.root / 'archives'; self.storage.mkdir()
        (self.storage / '.athlete-panel-storage-id').write_text('synthetic-marker')
        hosted.write_json(self.root / 'policy.json', {'version': 1, 'id': 'synthetic-marker', 'testOnly': True})
        self.env = {'DATABASE_URL': 'postgresql://app:synthetic@postgres:5432/training_test', 'APP_ORIGIN': 'https://localhost:4567',
                    'ENCRYPTION_KEY': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'COOKIE_SECURE': 'true', 'TRUST_PROXY_CLIENT_IP': 'true'}
        self.services = {name: {'image': IMAGE, 'environment': dict(self.env)} for name in self.roles.values()}
        self.services['postgres'] = {'image': 'postgres:17-bookworm', 'environment': {'POSTGRES_USER': 'admin', 'POSTGRES_PASSWORD': 'synthetic-admin', 'POSTGRES_DB': 'training_test'},
                                     'volumes': [{'type': 'volume', 'source': 'data', 'target': '/var/lib/postgresql/data'}]}
        for role in ['admin', 'recovery']:
            self.services[role]['environment']['DATABASE_URL'] = 'postgresql://admin:synthetic-admin@postgres:5432/training_test'
        self.services['admin']['environment'].update(APP_DATABASE_ROLE='app', APP_DATABASE_PASSWORD='synthetic')
        self.services['jobs']['command'] = ['node', 'dist/worker/index.js']
        self.services['archives']['command'] = ['pnpm', 'exec', 'tsx', 'scripts/operations.ts', 'backup-loop']
        for name in ['archives', 'recovery']:
            self.services[name]['user'] = str(os.getuid())
            self.services[name]['environment'].update(BACKUP_KEY_FILE='/run/secrets/key', BACKUP_STORAGE_POLICY='/run/secrets/policy', BACKUP_DESTINATION='/backups')
            self.services[name]['volumes'] = [{'type': 'bind', 'source': str(self.storage), 'target': '/backups'},
                                              {'type': 'bind', 'source': root + '/key', 'target': '/run/secrets/key', 'read_only': True},
                                              {'type': 'bind', 'source': root + '/policy.json', 'target': '/run/secrets/policy', 'read_only': True}]
        for service in self.services.values(): service['networks'] = {'custom': None}
        self.config = {'services': self.services, 'networks': {'custom': {'name': 'fixture-network'}}, 'volumes': {'data': {'name': 'retained-data'}}}
        self.containers = [{'Id': 'id-' + name, 'Image': IMAGE, 'State': {'Running': True},
                            'Config': {'Labels': {'com.docker.compose.service': name, 'com.docker.compose.config-hash': 'hash-' + name},
                                       'Env': [key + '=' + value for key, value in service['environment'].items()]},
                            'Mounts': [{'Type': item['type'], 'Source': item['source'], 'Name': 'retained-data' if item['type'] == 'volume' else None, 'Destination': item['target'], 'RW': not item.get('read_only', False)} for item in service.get('volumes', [])], 'NetworkSettings': {'Networks': {'fixture-network': {}}}}
                           for name, service in self.services.items() if name not in {'admin', 'recovery'}]
        self.metadata = {'application': 'athlete-panel', 'hostedProtocol': 1, 'version': '0.1.0', 'sourceDigest': 'c' * 64, 'plugins': [{'id': 'personal', 'enabled': True}]}

    def execute(self, args, **kwargs):
        args = [str(arg) for arg in args]; self.commands.append(args)
        command = args[3:] if args[1:2] == ['--context'] else args[1:]
        if command[:2] == ['context', 'inspect']: result = [{'Endpoints': {'docker': {'Host': 'unix:///fixture.sock'}}}]
        elif command[0] == 'info': result = {'OSType': 'linux', 'Architecture': 'amd64', 'ID': 'fixture-daemon'}
        elif command[0] == 'compose':
            if '--hash' in command: return subprocess.CompletedProcess(args, 0, '\n'.join(name + ' hash-' + name for name in self.services), '')
            result = self.config
        elif command[0] == 'ps': return subprocess.CompletedProcess(args, 0, ' '.join(item['Id'] for item in self.containers), '')
        elif command[0] == 'inspect': result = self.containers
        elif command[:2] == ['image', 'inspect']: result = [{'Id': IMAGE, 'Os': 'linux', 'Architecture': 'amd64', 'RepoDigests': []}]
        elif command[:2] == ['volume', 'inspect']: result = [{'Name': 'retained-data', 'Driver': 'local', 'Mountpoint': '/retained', 'CreatedAt': 'original'}]
        elif command[:2] == ['network', 'inspect']: result = [{'Name': 'fixture-network', 'Id': 'network-original', 'Internal': True}]
        elif command[0] == 'exec' and 'cat' in command: result = self.metadata
        elif command[0] == 'exec' and 'psql' in command: return subprocess.CompletedProcess(args, 0, '123456789', '')
        elif command[0] == 'save':
            Path(command[command.index('-o') + 1]).write_bytes(b'synthetic retained image')
            return subprocess.CompletedProcess(args, 0, '', '')
        else: raise AssertionError('Unexpected mutation or inspection: ' + repr(args))
        return subprocess.CompletedProcess(args, 0, json.dumps(result), '')


class Adoption(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(sys.modules, {'hosted': hosted}))
        self.stack.enter_context(patch.object(image_identity, 'identify', return_value=IDENTITY))
        self.stack.enter_context(patch.object(image_identity, 'archive_identity', return_value=IDENTITY))

    def test_cli_preview_rejection_is_sanitized_and_does_not_create_state(self):
        state = hosted.ROOT / 'forbidden-adoption-state'
        result = subprocess.run([sys.executable, str(hosted.ROOT / 'scripts/hosted.py'), '--state', str(state), 'adopt',
                                 '--context', 'default', '--project', 'synthetic', '--project-directory', '/not-used',
                                 '--compose-file', '/not-used/compose.yml', '--env-file', '/not-used/app.env', '--ingress', 'external', '--dry-run'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1); self.assertNotIn('Traceback', result.stderr)
        self.assertIn('outside the source', result.stderr); self.assertFalse(state.exists())

    def test_preview_and_confirmation_preserve_every_existing_file_and_container(self):
        for ingress in ['caddy', 'external']:
            with self.subTest(ingress=ingress), tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root, ingress); state = Path(root) / 'operator'
                before = {str(path): path.read_bytes() for path in Path(root).rglob('*') if path.is_file()}
                containers = copy.deepcopy(fixture.containers)
                preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test={'port': 4567})
                self.assertFalse(state.exists()); self.assertNotIn('ENCRYPTION_KEY', json.dumps(preview))
                self.assertNotIn('synthetic-admin', json.dumps(preview))
                result = adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, {'port': 4567}, root)
                self.assertTrue(result['adopted']); self.assertEqual(fixture.containers, containers)
                self.assertTrue(all(Path(path).read_bytes() == data for path, data in before.items()))
                record = hosted.read_json(state / 'installation.json')
                self.assertEqual(record['active']['metadata']['plugins'], fixture.metadata['plugins'])
                self.assertEqual(record['profile']['cluster'], '123456789')
                self.assertEqual((state / 'installation.json').stat().st_mode & 0o777, 0o600)
                again = adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, {'port': 4567}, root)
                self.assertTrue(again['unchanged'])
                self.assertFalse(any(any(word in command for word in ['up', 'run', 'stop', 'restart', 'migrate']) for command in fixture.commands))

    def test_stale_preview_rejected_before_state_and_duplicate_owner_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); state = Path(root) / 'operator'
            preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test=True)
            Path(fixture.inputs['envFiles'][0]).write_text('CHANGED=synthetic\n')
            with self.assertRaisesRegex(hosted.OperationError, 'stale'): adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, True, root)
            self.assertFalse(state.exists())
            preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test=True)
            adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, True, root)
            with self.assertRaisesRegex(hosted.OperationError, 'another controller state'):
                adoption.adopt(Path(root) / 'duplicate', fixture.inputs, preview['confirmation'], fixture.execute, True, root)

    def test_interrupted_profile_write_can_be_retried_with_same_ownership(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); state = Path(root) / 'operator'
            preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test=True)
            original = hosted.write_json
            def write(path, value):
                if Path(path).name == 'installation.json': raise OSError('synthetic interruption')
                return original(path, value)
            with patch.object(hosted, 'write_json', side_effect=write):
                with self.assertRaises(OSError): adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, True, root)
            self.assertFalse((state / 'installation.json').exists()); self.assertFalse((state / 'adopted-image.partial').exists())
            adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, True, root)
            self.assertTrue((state / 'installation.json').exists())

    def test_project_lock_coordinates_different_state_paths(self):
        with tempfile.TemporaryDirectory() as root:
            with adoption.project_lock('daemon', 'project', root + '/one', claim=True, root=root):
                with self.assertRaisesRegex(hosted.OperationError, 'Another controller'):
                    with adoption.project_lock('daemon', 'project', root + '/two', claim=True, root=root): pass

    def test_unsupported_layouts_do_not_create_state_or_expose_values(self):
        mutations = [lambda f: f.inputs.update(project='athlete-panel-hosted-0123456789'),
                     lambda f: f.services['postgres'].update(image='postgres:18'),
                     lambda f: f.services['jobs'].update(command=['sh', '/private/wrapper']),
                     lambda f: f.services['ui'].update(volumes=[{'type': 'bind', 'source': str(f.root), 'target': '/app'}]),
                     lambda f: f.containers[0]['Config']['Labels'].update({'com.docker.compose.config-hash': 'stale'}),
                     lambda f: f.services['archives']['environment'].pop('BACKUP_STORAGE_POLICY')]
        for mutation in mutations:
            with tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root); mutation(fixture)
                with self.assertRaises(hosted.OperationError) as error:
                    adoption.adopt(Path(root) / 'state', fixture.inputs, execute=fixture.execute, test=True)
                self.assertFalse((Path(root) / 'state').exists())
                self.assertNotIn('synthetic-admin', str(error.exception))

    def test_reordered_mounts_are_stable_but_changed_sources_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root)
            first, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            backup = next(item for item in fixture.containers if item['Id'] == 'id-archives')
            backup['Mounts'].reverse()
            second, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            self.assertEqual(adoption.fingerprint(first), adoption.fingerprint(second))
            backup['Mounts'][0]['Source'] = '/different-secret'
            with self.assertRaisesRegex(hosted.OperationError, 'storage mounts disagree'): adoption.inspect(fixture.inputs, fixture.execute, True)

    def test_drift_blocks_before_upgrade_intent_or_maintenance(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            instance = hosted.Hosted(Path(root) / 'state', test={'port': 4567})
            instance.record = {'profile': profile, 'active': profile['release']}
            Path(fixture.inputs['files'][0]).write_text('changed')
            with patch.object(instance, 'begin') as begin:
                with self.assertRaisesRegex(hosted.OperationError, 'reconcile'): instance.upgrade(local_image=IMAGE)
                begin.assert_not_called()

    def test_same_source_rebuild_does_not_substitute_initial_adopted_image(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            instance.record = {'profile': {'release': {'metadata': {'sourceDigest': 'c' * 64}, 'identity': IDENTITY}}}
            with patch.object(instance, 'run') as run:
                self.assertIsNone(instance.load_adopted_image({'sourceDigest': 'c' * 64, 'imageId': 'sha256:' + 'f' * 64,
                    'identity': {**IDENTITY, 'configDigest': 'sha256:' + 'f' * 64}}))
                run.assert_not_called()

    def test_reconciliation_requires_fresh_confirmation_and_preserves_initial_recovery(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            profile['imageArchive'] = {'path': '/retained/image.tar', 'sha256': 'd' * 64}
            instance = hosted.Hosted(Path(root) / 'state', test={'port': 4567})
            instance.record = {'version': 2, 'project': fixture.inputs['project'], 'profile': profile, 'active': profile['release']}
            original_release = copy.deepcopy(profile['release'])
            real_inspect = adoption.inspect
            def inspect(inputs, **kwargs): return real_inspect(inputs, execute=fixture.execute, **kwargs)
            with patch.object(adoption, 'inspect', side_effect=inspect):
                Path(fixture.inputs['files'][1]).write_text('{}\n\n')
                preview = adoption.reconcile(instance)
                self.assertEqual(preview['changes']['files'], [fixture.inputs['files'][1]])
                Path(fixture.inputs['files'][1]).write_text('{}\n\n\n')
                with self.assertRaisesRegex(hosted.OperationError, 'stale'): adoption.reconcile(instance, preview['confirmation'])
                preview = adoption.reconcile(instance); adoption.reconcile(instance, preview['confirmation'])
                self.assertEqual(instance.record['profile']['release'], original_release)
                self.assertEqual(instance.record['profile']['imageArchive']['path'], '/retained/image.tar')
                Path(root, 'key').write_text('changed-key')
                with self.assertRaisesRegex(hosted.OperationError, 'backup key'): adoption.reconcile(instance)

    def test_saved_model_preserves_names_routing_mounts_and_credentials_during_upgrade(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root, 'caddy'); profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            instance = hosted.Hosted(Path(root) / 'state', test={'port': 4567})
            instance.record = {'profile': profile, 'project': fixture.inputs['project']}
            release = {**profile['release'], 'image': 'sha256:' + 'd' * 64, 'database': 'recovered_test'}
            adoption.deployment(instance, release)
            config = hosted.read_json(instance.state / 'deployment.json')
            for name in ['postgres', 'caddy']: self.assertEqual(config['services'][name], fixture.services[name])
            for role in adoption.APPLICATION:
                name = fixture.roles[role]; service = config['services'][name]
                self.assertEqual(service.get('volumes'), fixture.services[name].get('volumes'))
                self.assertEqual(service['environment']['ENCRYPTION_KEY'], fixture.env['ENCRYPTION_KEY'])
                self.assertTrue(service['environment']['DATABASE_URL'].endswith('/recovered_test'))
            self.assertEqual(config['volumes']['data'], {'external': True, 'name': 'retained-data'})


if __name__ == '__main__': unittest.main()
