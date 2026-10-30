"""Synthetic inspection, ownership, interruption and preservation boundaries."""
from contextlib import ExitStack
import copy
import io
import json
import os
import shutil
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
DB_IMAGE = 'sha256:' + 'b' * 64
IDENTITY = {'format': 1, 'os': 'linux', 'architecture': 'amd64', 'variant': '', 'configDigest': IMAGE}


class Fixture:
    def __init__(self, root, ingress='external', backup_mode='remote'):
        self.root = Path(root); self.commands = []
        self.database_version = '170006'; self.database_image = DB_IMAGE; self.cluster = '123456789'
        self.volume_created = 'original'
        self.inputs = {'project': 'training-a', 'directory': root, 'context': 'fixture', 'ingress': ingress,
                       'files': [root + '/compose.json', root + '/override.json'], 'envFiles': [root + '/app.env'],
                       'roles': {'web': 'ui', 'worker': 'jobs', 'db': 'postgres', 'backup': 'archives'}}
        self.roles = {role: self.inputs['roles'].get(role, role) for role in adoption.ROLES}
        if ingress == 'caddy': self.roles['caddy'] = 'caddy'
        for name in ['compose.json', 'override.json', 'app.env', 'key', 'policy.json']:
            hosted.write_json(self.root / name, {})
        (self.root / 'key').write_text('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
        self.storage = self.root / 'archives'; self.storage.mkdir(mode=0o700)
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
        if backup_mode == 'local':
            (self.storage / '.athlete-panel-storage-id').unlink()
            for name in ['archives', 'recovery']:
                self.services[name]['environment'].pop('BACKUP_STORAGE_POLICY', None)
                self.services[name]['volumes'] = [volume for volume in self.services[name]['volumes'] if volume['source'] != root + '/policy.json']
        for service in self.services.values(): service['networks'] = {'custom': None}
        self.config = {'services': self.services, 'networks': {'custom': {'name': 'fixture-network'}}, 'volumes': {'data': {'name': 'retained-data'}}}
        self.containers = [{'Id': 'id-' + name, 'Image': DB_IMAGE if name == 'postgres' else IMAGE, 'State': {'Running': True},
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
        elif command[0] == 'ps':
            selected = self.containers
            for arg in command:
                if arg.startswith('label=com.docker.compose.service='):
                    selected = [item for item in selected if item['Config']['Labels']['com.docker.compose.service'] == arg.rsplit('=', 1)[1]]
                elif arg.startswith('label=io.athlete-panel.operation='): selected = []
            return subprocess.CompletedProcess(args, 0, ' '.join(item['Id'] for item in selected), '')
        elif command[0] == 'inspect': result = [item for item in self.containers if item['Id'] in command[1:]]
        elif command[:2] == ['image', 'inspect']: result = [{'Id': self.database_image if 'postgres' in command[2] else IMAGE, 'Os': 'linux', 'Architecture': 'amd64', 'RepoDigests': []}]
        elif command[:2] == ['volume', 'inspect']: result = [{'Name': 'retained-data', 'Driver': 'local', 'Mountpoint': '/retained', 'CreatedAt': self.volume_created}]
        elif command[:2] == ['network', 'inspect']: result = [{'Name': 'fixture-network', 'Id': 'network-original', 'Internal': True}]
        elif command[0] == 'exec' and 'cat' in command: result = self.metadata
        elif command[0] == 'exec' and 'psql' in command: return subprocess.CompletedProcess(args, 0, self.database_version if command[-1] == 'show server_version_num' else self.cluster, '')
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
        for ingress, mode in [('caddy', 'remote'), ('external', 'remote'), ('caddy', 'local'), ('external', 'local')]:
            with self.subTest(ingress=ingress, mode=mode), tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root, ingress, mode); state = Path(root) / 'operator'
                before = {str(path): path.read_bytes() for path in Path(root).rglob('*') if path.is_file()}
                containers = copy.deepcopy(fixture.containers)
                preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test={'port': 4567})
                self.assertFalse(state.exists()); self.assertNotIn('ENCRYPTION_KEY', json.dumps(preview))
                self.assertNotIn('synthetic-admin', json.dumps(preview))
                result = adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, {'port': 4567}, root)
                self.assertTrue(result['adopted']); self.assertEqual(fixture.containers, containers)
                self.assertTrue(all(Path(path).read_bytes() == data for path, data in before.items()))
                record = hosted.read_json(state / 'installation.json')
                self.assertEqual(record['backupMode'], mode)
                instance = hosted.Hosted(state, test={'port':4567})
                instance.verify_storage()
                adoption.deployment(instance, record['active'])
                deployed = hosted.read_json(state / 'deployment.json')
                self.assertEqual(deployed['services']['archives']['environment']['BACKUP_STORAGE_MODE'], mode)
                self.assertEqual('BACKUP_STORAGE_POLICY' in deployed['services']['archives']['environment'], mode == 'remote')
                self.assertEqual(record['active']['metadata']['plugins'], fixture.metadata['plugins'])
                self.assertEqual(record['profile']['cluster'], '123456789')
                self.assertEqual((state / 'installation.json').stat().st_mode & 0o777, 0o600)
                again = adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, {'port': 4567}, root)
                self.assertTrue(again['unchanged'])
                self.assertFalse(any(any(word in command for word in ['up', 'run', 'stop', 'restart', 'migrate']) for command in fixture.commands))

    def test_adoption_cannot_downgrade_remote_policy_or_infer_local_from_lost_policy(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root)
            fixture.inputs['backupMode'] = 'local'
            with self.assertRaisesRegex(hosted.OperationError, 'conflicts'): adoption.inspect(fixture.inputs, fixture.execute, True)
            fixture.inputs.pop('backupMode')
            (Path(root) / 'policy.json').unlink()
            with self.assertRaises(hosted.OperationError): adoption.inspect(fixture.inputs, fixture.execute, True)
            for name in ['archives', 'recovery']:
                fixture.services[name]['environment'].pop('BACKUP_STORAGE_POLICY', None)
                fixture.services[name]['volumes'] = [v for v in fixture.services[name]['volumes'] if v['source'] != root + '/policy.json']
            with self.assertRaisesRegex(hosted.OperationError, 'remote storage identity'): adoption.inspect(fixture.inputs, fixture.execute, True)

    def test_local_adoption_rejects_public_directory_without_changing_permissions(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root, backup_mode='local'); fixture.storage.chmod(0o755)
            with self.assertRaisesRegex(hosted.OperationError, '0700'): adoption.inspect(fixture.inputs, fixture.execute, True)
            self.assertEqual(fixture.storage.stat().st_mode & 0o777, 0o755)

    def test_reconciliation_cannot_switch_backup_mode_or_destination(self):
        for mode in ['local', 'remote']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root, backup_mode=mode)
                profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
                instance = hosted.Hosted(Path(root) / 'state', test={'port':4567})
                instance.record = {'project': fixture.inputs['project'], 'profile': profile, 'backupMode': mode}
                for field, replacement in [('backupMode', 'remote' if mode == 'local' else 'local'), ('backupDirectory', root + '/other'), ('storagePolicy', root + '/other-policy')]:
                    changed = copy.deepcopy(profile); changed[field] = replacement
                    with patch.object(adoption, 'inspect', return_value=(changed, {'confirmation': 'synthetic'})):
                        with self.assertRaisesRegex(hosted.OperationError, 'cannot change backup'): adoption.reconcile(instance)
                    self.assertEqual(instance.record['profile'], profile)

    def test_reconcile_accepts_controller_mode_added_to_legacy_compose_but_rejects_downgrade(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root)
            fixture.services['archives']['environment']['BACKUP_STORAGE_MODE'] = ''
            container = next(item for item in fixture.containers if item['Id'] == 'id-archives')
            container['Config']['Env'].append('BACKUP_STORAGE_MODE=')
            profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
            instance = hosted.Hosted(Path(root) / 'state', test={'port':4567})
            instance.record = {'profile': profile, 'active': profile['release']}  # Legacy remote record.
            adoption.inspect(fixture.inputs, fixture.execute, True, managed=instance)
            container['Config']['Env'][-1] = 'BACKUP_STORAGE_MODE=remote'
            adoption.inspect(fixture.inputs, fixture.execute, True, managed=instance)
            container['Config']['Env'][-1] = 'BACKUP_STORAGE_MODE=local'
            with self.assertRaisesRegex(hosted.OperationError, 'Running backup mode'):
                adoption.inspect(fixture.inputs, fixture.execute, True, managed=instance)

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

    def test_permanent_claim_survives_legacy_cleanup_and_rejects_duplicate_owners(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'state'
            name = 'athlete-panel-controller-' + adoption.fingerprint({'daemon': 'daemon', 'project': 'project'})
            legacy = hosted.private_directory(Path(root) / 'legacy' / name)
            owner = {'version': 1, 'state': str(state.resolve()), 'daemon': 'daemon', 'project': 'project'}
            hosted.write_json(legacy / 'owner.json', owner)
            original = (legacy / 'owner.json').read_bytes()
            with adoption.project_lock('daemon', 'project', state, root=root) as permanent:
                self.assertEqual(hosted.read_json(permanent / 'owner.json'), owner)
                self.assertEqual((legacy / 'owner.json').read_bytes(), original)
                with self.assertRaisesRegex(hosted.OperationError, 'Another controller'):
                    with adoption.claim_lock(legacy): pass
            shutil.rmtree(legacy)  # Synthetic tmpfiles cleanup; durable ownership remains.
            with adoption.project_lock('daemon', 'project', state, root=root): pass
            with self.assertRaisesRegex(hosted.OperationError, 'another controller state'):
                with adoption.project_lock('daemon', 'project', Path(root) / 'second', claim=True, root=root): pass

    def test_missing_claim_does_not_silently_reclaim_an_adopted_project(self):
        with tempfile.TemporaryDirectory() as root:
            with adoption.project_lock('daemon', 'project', root + '/state', claim=True, root=root) as directory: pass
            shutil.rmtree(directory)
            with self.assertRaisesRegex(hosted.OperationError, 'ownership record is missing'):
                with adoption.project_lock('daemon', 'project', root + '/state', root=root): pass
            self.assertFalse((directory / 'owner.json').exists())

    def test_conflicting_legacy_owner_does_not_reserve_the_migration_target(self):
        with tempfile.TemporaryDirectory() as root:
            name = 'athlete-panel-controller-' + adoption.fingerprint({'daemon': 'daemon', 'project': 'project'})
            legacy = hosted.private_directory(Path(root) / 'legacy' / name)
            hosted.write_json(legacy / 'owner.json', {'version': 1, 'state': 'other-owner', 'daemon': 'daemon', 'project': 'project'})
            with self.assertRaisesRegex(hosted.OperationError, 'another controller state'):
                with adoption.project_lock('daemon', 'project', root + '/state', claim=True, root=root): pass
            self.assertFalse((Path(root) / name).exists())

    def test_conflicting_legacy_claim_blocks_adoption_even_with_a_permanent_claim(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'state'
            with adoption.project_lock('daemon', 'project', state, claim=True, root=root) as directory: pass
            legacy = hosted.private_directory(Path(root) / 'legacy' / directory.name)
            hosted.write_json(legacy / 'owner.json', {'version': 1, 'state': 'different', 'daemon': 'daemon', 'project': 'project'})
            with self.assertRaisesRegex(hosted.OperationError, 'another controller state'):
                with adoption.project_lock('daemon', 'project', state, root=root): pass

    def test_interrupted_migration_retries_without_replacing_ownership(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / 'state'
            name = 'athlete-panel-controller-' + adoption.fingerprint({'daemon': 'daemon', 'project': 'project'})
            legacy = hosted.private_directory(Path(root) / 'legacy' / name)
            owner = {'version': 1, 'state': str(state.resolve()), 'daemon': 'daemon', 'project': 'project'}
            hosted.write_json(legacy / 'owner.json', owner)
            real_write = hosted.write_json
            def crash(path, value):
                real_write(path, value)
                raise InterruptedError('synthetic interruption after durable claim')
            with patch.object(hosted, 'write_json', side_effect=crash):
                with self.assertRaises(InterruptedError):
                    with adoption.project_lock('daemon', 'project', state, root=root): pass
            with adoption.project_lock('daemon', 'project', state, root=root) as directory:
                self.assertEqual(hosted.read_json(directory / 'owner.json'), owner)

    def test_controller_refreshes_recovery_reference_after_legacy_migration(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); state = Path(root) / 'state'
            preview = adoption.adopt(state, fixture.inputs, execute=fixture.execute, test=True)
            adoption.adopt(state, fixture.inputs, preview['confirmation'], fixture.execute, True, root)
            instance = hosted.Hosted(state, test=True); instance.lock_root = root
            directory = Path(instance.record['ownershipDirectory'])
            legacy = Path(root) / 'legacy' / directory.name; legacy.parent.mkdir()
            directory.rename(legacy)
            instance.record['ownershipDirectory'] = str(legacy); instance.save()
            with instance.lock(): pass
            self.assertEqual(hosted.read_json(state / 'installation.json')['ownershipDirectory'], str(directory))
            self.assertTrue((legacy / 'owner.json').is_file())

    def test_missing_system_registry_has_actionable_setup_without_temporary_fallback(self):
        self.assertEqual(str(adoption.OWNERSHIP_ROOT), '/var/lib/athlete-panel/controllers')
        with tempfile.TemporaryDirectory() as root, patch.object(adoption, 'OWNERSHIP_ROOT', Path(root) / 'missing'), patch.object(adoption.os, 'geteuid', return_value=12345):
            with self.assertRaisesRegex(hosted.OperationError, 'sudo install -d.*1777'):
                adoption.ownership_root()
            self.assertFalse((Path(root) / 'missing').exists())

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
            self.assertEqual(config['services']['caddy'], fixture.services['caddy'])
            self.assertEqual(config['services']['postgres'], {**fixture.services['postgres'], 'image': DB_IMAGE, 'pull_policy': 'never'})
            for role in adoption.APPLICATION:
                name = fixture.roles[role]; service = config['services'][name]
                expected_mounts = copy.deepcopy(fixture.services[name].get('volumes'))
                for mount in expected_mounts or []:
                    if mount['type'] == 'bind': mount['bind'] = {'create_host_path': False}
                self.assertEqual(service.get('volumes'), expected_mounts)
                self.assertEqual(service['environment']['ENCRYPTION_KEY'], fixture.env['ENCRYPTION_KEY'])
                self.assertTrue(service['environment']['DATABASE_URL'].endswith('/recovered_test'))
            self.assertEqual(config['volumes']['data'], {'external': True, 'name': 'retained-data'})

    def test_postgres_tag_and_digest_require_running_major_and_matching_image(self):
        for reference in ['postgres:17', 'postgres:17-bookworm', 'postgres:17.6',
                          'postgres@' + DB_IMAGE, 'postgres:17@' + DB_IMAGE, 'docker.io/library/postgres@' + DB_IMAGE]:
            with self.subTest(reference=reference), tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root); fixture.services['postgres']['image'] = reference
                with patch.object(image_identity, 'identify', return_value=IDENTITY) as identify:
                    profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
                    self.assertEqual(profile['runtime']['postgres']['image'], DB_IMAGE)
                    if '@' in reference:
                        self.assertEqual(identify.call_args_list[0].args[2], 'docker.io/library/postgres@' + DB_IMAGE)
                for version in ['160009', '180001', 'invalid']:
                    fixture.database_version = version
                    with self.assertRaisesRegex(hosted.OperationError, 'running database must be PostgreSQL 17'):
                        adoption.inspect(fixture.inputs, fixture.execute, True)
                fixture.database_version = '170006'; fixture.database_image = IMAGE
                with self.assertRaisesRegex(hosted.OperationError, 'image differs'):
                    adoption.inspect(fixture.inputs, fixture.execute, True)

    def test_postgres_digest_proof_failure_is_not_ignored(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); fixture.services['postgres']['image'] = 'postgres@' + DB_IMAGE
            with patch.object(image_identity, 'identify', side_effect=image_identity.ImageIdentityError('Registry manifest configuration differs')):
                with self.assertRaises(image_identity.ImageIdentityError): adoption.inspect(fixture.inputs, fixture.execute, True)

    def controller(self, fixture):
        profile, _ = adoption.inspect(fixture.inputs, fixture.execute, True)
        instance = hosted.Hosted(fixture.root / 'state', test={'port': 4567})
        instance.record = {'version': 2, 'project': fixture.inputs['project'], 'profile': profile, 'testOnly': True,
                           'active': copy.deepcopy(profile['release']), 'database': 'training_test', 'backupDirectory': str(fixture.storage)}
        self.stack.enter_context(patch.object(adoption, 'run', side_effect=fixture.execute))
        self.stack.enter_context(patch.object(instance, 'run', side_effect=fixture.execute))
        self.stack.enter_context(patch.object(instance, 'image_matches', side_effect=lambda image, release: image == release['image']))
        return instance

    def test_missing_backup_resume_recreates_only_backup_and_verifies_new_attempt(self):
        for already_verified in [False, True]:
            with self.subTest(already_verified=already_verified), tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root); instance = self.controller(fixture)
                original = copy.deepcopy(fixture.containers)
                backup = next(item for item in fixture.containers if item['Id'] == 'id-archives')
                fixture.containers.remove(backup)
                instance.begin('upgrade', previous=instance.record['active'], candidate=copy.deepcopy(instance.record['active']))
                instance.pending['completed'] = ['reopen-application'] + (['verify-scheduled-backup'] if already_verified else [])
                def compose(release, args):
                    self.assertEqual(args, ['--profile', 'backup', 'up', '-d', '--no-deps', 'backup'])
                    backup['Id'] = 'new-backup'; fixture.containers.append(backup)
                def verified(release): instance.pending['verifiedBackup'] = {'file': 'new.fgr'}
                with patch.object(instance, 'docker_ready'), patch.object(instance, 'verify_deployed') as ready, patch.object(instance, 'maintenance') as maintenance, patch.object(instance, 'console') as console, patch.object(instance, 'compose', side_effect=compose) as created, patch.object(instance, 'await_backup', side_effect=verified) as verify:
                    instance.resume()
                    created.assert_called_once(); verify.assert_called_once(); ready.assert_called_once()
                    maintenance.assert_not_called(); console.assert_not_called()
                self.assertIsNone(instance.pending)
                self.assertEqual(instance.record['profile']['runtime']['archives']['id'], 'new-backup')
                self.assertEqual([c for c in fixture.containers if c is not backup], [c for c in original if c['Id'] != 'id-archives'])

    def test_missing_web_allows_explicit_recovery_to_reach_archive_preparation(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root); instance = self.controller(fixture)
            fixture.containers = [c for c in fixture.containers if c['Id'] != 'id-ui']
            with patch.object(instance, 'docker_ready'), patch.object(instance, 'recovery_tools', side_effect=RuntimeError('reached recovery preparation')) as prepare:
                with self.assertRaisesRegex(RuntimeError, 'reached recovery preparation'):
                    instance.recover(fixture.root / 'synthetic.fgr')
                prepare.assert_called_once()

    def test_missing_roles_are_allowed_only_when_the_stage_can_recreate_them(self):
        stages = [(None, [], set()), ('restore-test', [], set()), ('upgrade', [], set()),
                  ('upgrade', ['verify-pre-upgrade-backup'], {'web', 'worker', 'backup'}),
                  ('recover', [], {'web', 'worker', 'backup'}),
                  ('upgrade', ['reopen-application'], {'backup'}), ('recover', ['reopen-application'], {'backup'})]
        for kind, completed, allowed in stages:
            for role in ['web', 'worker', 'backup', 'db', 'caddy']:
                with self.subTest(kind=kind, completed=completed, role=role), tempfile.TemporaryDirectory() as root:
                    fixture = Fixture(root, 'caddy'); instance = self.controller(fixture)
                    instance.pending = {'kind': kind, 'completed': completed} if kind else None
                    fixture.containers = [c for c in fixture.containers if c['Config']['Labels']['com.docker.compose.service'] != fixture.roles[role]]
                    if role in allowed: self.assertEqual(adoption.guard(instance), {role})
                    else:
                        with self.assertRaisesRegex(hosted.OperationError, 'mapped container'): adoption.guard(instance)

    def test_missing_container_does_not_bypass_persistent_state_or_runtime_guards(self):
        mutations = [lambda f: setattr(f, 'cluster', '999'), lambda f: setattr(f, 'volume_created', 'replacement'),
                     lambda f: setattr(f, 'database_version', '180001'),
                     lambda f: (f.storage / '.athlete-panel-storage-id').write_text('replacement'),
                     lambda f: Path(f.inputs['files'][0]).write_text('changed'),
                     lambda f: (f.root / 'key').write_text('changed'),
                     lambda f: f.containers.append(copy.deepcopy(f.containers[0])),
                     lambda f: f.containers[0].update(Image='sha256:' + 'e' * 64),
                     lambda f: f.containers[0]['NetworkSettings'].update(Networks={'unexpected': {}}),
                     lambda f: next(c for c in f.containers if c['Id'] == 'id-postgres')['Mounts'][0].update(Name='replacement')]
        for mutation in mutations:
            with tempfile.TemporaryDirectory() as root:
                fixture = Fixture(root); instance = self.controller(fixture)
                instance.pending = {'kind': 'recover', 'completed': []}
                fixture.containers = [c for c in fixture.containers if c['Id'] != 'id-archives']
                mutation(fixture)
                with self.assertRaises(hosted.OperationError): adoption.guard(instance)


if __name__ == '__main__': unittest.main()
