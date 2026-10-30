"""Pure controller safety checks. No Docker commands or owner data."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import tarfile
import sys

spec = importlib.util.spec_from_file_location('hosted', Path(__file__).resolve().parents[2] / 'scripts/hosted.py')
hosted = importlib.util.module_from_spec(spec); spec.loader.exec_module(hosted)


class HostedSafety(unittest.TestCase):
    def test_image_comparison_preserves_prerequisite_errors_instead_of_claiming_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            release = {'image': 'sha256:' + 'a' * 64, 'registryRef': 'registry.example/app@sha256:' + 'b' * 64}
            with patch.object(hosted.image_identity, 'identify', side_effect=hosted.image_identity.ImagePrerequisiteError('Docker Buildx is required')):
                with self.assertRaisesRegex(ValueError, 'Buildx'): instance.image_matches('sha256:' + 'c' * 64, release)
            with patch.object(hosted.image_identity, 'identify', side_effect=hosted.image_identity.ImageIdentityError('mismatch')):
                self.assertFalse(instance.image_matches('sha256:' + 'c' * 64, release))

    def test_docker_readiness_does_not_require_buildx_for_local_resume_or_recovery(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                if 'buildx' in args: raise AssertionError('Local readiness must not require Buildx')
                return hosted.subprocess.CompletedProcess(args, 0, '', '')
            with patch.object(instance, 'run', side_effect=run): instance.docker_ready()
            self.assertEqual(calls, [['docker', 'info'], ['docker', 'compose', 'version']])

    def test_source_build_reports_missing_buildx_before_starting_build(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(Path(root) / 'state')
            source = Path(root) / 'source'; source.mkdir(); (source / 'Dockerfile').write_text('FROM scratch\n')
            instance.record = {'project': 'synthetic'}; instance.begin('upgrade')
            with patch.object(instance, 'run', side_effect=hosted.OperationError('synthetic private output')) as run:
                with self.assertRaisesRegex(ValueError, 'Docker Buildx.*Install'): instance.prepare_image(source)
                self.assertEqual(run.call_args.args[0], ['docker', 'buildx', 'version'])
                self.assertEqual(run.call_count, 1)

    def test_saved_operator_state_is_reused_and_invalid_projects_are_refused(self):
        with tempfile.TemporaryDirectory() as home:
            state = Path(home)/'.local/share/athlete-panel/hosted'
            self.assertEqual(hosted.default_state(home),state)
            state.mkdir(parents=True,mode=0o700)
            record={'version':1,'project':'athlete-panel-hosted-0123456789','database':'athlete_panel','testOnly':False}
            hosted.write_json(state/'installation.json',record)
            self.assertEqual(hosted.Hosted(state).record,record)
            hosted.write_json(state/'installation.json',{**record,'project':'unrelated-project'})
            with self.assertRaises(hosted.OperationError):hosted.Hosted(state)

    def test_configuration_preserves_explicit_database_identities_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root)/'.env'
            original = 'ATHLETE_PANEL_DOMAIN="training.example.com"\nPOSTGRES_USER="custom_admin"\nAPP_DATABASE_ROLE="custom_app"\n'
            config.write_text(original);config.chmod(0o600)
            values=hosted.parse_configuration(config)
            self.assertEqual(values['ATHLETE_PANEL_DOMAIN'],'training.example.com')
            self.assertEqual(values['POSTGRES_USER'],'custom_admin')
            self.assertEqual(values['APP_DATABASE_ROLE'],'custom_app')
            self.assertEqual(config.read_text(),original)

    def test_missing_image_metadata_is_rejected_before_candidate_activation(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root);image='sha256:'+'a'*64
            instance.record={'project':'athlete-panel-hosted-0123456789','database':'athlete_panel'}
            instance.begin('upgrade',resolvedImages={'candidate':{'image':image,'registryRef':None,'origin':{'kind':'local'}}})
            commands=[]
            def run(args,**kwargs):
                commands.append(args)
                if args[1]=='create':return hosted.subprocess.CompletedProcess(args,0,'fixture-container','')
                if args[1]=='cp' and '.athlete-panel-release.json' in args[2]:return hosted.subprocess.CompletedProcess(args,1,'','missing')
                return hosted.subprocess.CompletedProcess(args,0,'','')
            with patch.object(instance,'run',side_effect=run):
                with self.assertRaisesRegex(hosted.OperationError,'metadata is missing'):instance.prepare_image(local=image)
            self.assertNotIn('candidate',instance.pending)
            self.assertIn(['docker','rm','fixture-container'],commands)

    def test_deployment_keeps_cluster_users_and_escapes_healthcheck_variables(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root,test={'port':4443})
            instance.record={'project':'athlete-panel-hosted-0123456789','domain':'training.example.com','database':'athlete_panel_test','backupDirectory':root+'/backups'}
            config=Path(root)/'.env'
            config.write_text('ATHLETE_PANEL_DOMAIN="training.example.com"\nPOSTGRES_PASSWORD="synthetic-admin"\nAPP_DATABASE_PASSWORD="synthetic-app"\n');config.chmod(0o600)
            (Path(root)/'Caddyfile').write_text('synthetic ingress')
            template={'services':{name:{'environment':{},'image':'fixture'} for name in ['web','worker','admin','backup','recovery','db','caddy']}}
            template['services']['db']['image']='postgres:17-bookworm';template['services']['db']['healthcheck']={}
            release={'database':'athlete_panel_test','controls':root,'image':'sha256:'+'a'*64,'metadata':{'application':'athlete-panel','sourceDigest':'b'*64,'version':'0.1.0'}}
            with patch.object(instance,'run',return_value=hosted.subprocess.CompletedProcess([],0,json.dumps(template),'')):
                instance.deployment(release)
            deployment=json.loads((Path(root)/'deployment.json').read_text())
            self.assertEqual(deployment['name'],instance.record['project'])
            self.assertIn('://athlete_panel_app:',deployment['services']['web']['environment']['DATABASE_URL'])
            self.assertEqual(deployment['services']['admin']['environment']['APP_DATABASE_ROLE'],'athlete_panel_app')
            self.assertEqual(deployment['services']['db']['environment']['POSTGRES_USER'],'athlete_panel')
            self.assertIn('$$POSTGRES_USER',deployment['services']['db']['healthcheck']['test'][1])
            self.assertIn('ATHLETE_PANEL_RELEASE_IDENTITY',deployment['services']['backup']['environment'])

    def test_upgrade_cli_uses_bundle_digest_without_a_source_checkout(self):
        with tempfile.TemporaryDirectory() as root:
            reference='ghcr.io/example/app@sha256:'+'e'*64
            Path(root,'release.json').write_text(json.dumps({'format':1,'image':reference}))
            with patch.object(hosted,'ROOT',Path(root)), patch.object(hosted,'Hosted') as constructor, patch.object(sys,'argv',['hosted.py','upgrade']):
                self.assertEqual(hosted.main(),0)
                constructor.return_value.upgrade.assert_called_once_with(source=None,image_ref=reference,local_image=None,accept_custom_changes=False)

    def test_image_selection_requires_an_explicit_version(self):
        for value in ['ghcr.io/example/athlete-panel:v1.2.3', 'localhost:5000/test/app@sha256:'+'a'*64]:
            self.assertEqual(hosted.image_reference(value),value)
        for value in ['ghcr.io/example/athlete_panel','ghcr.io/example/athlete-panel:latest','https://registry/app:v1','--help','registry/app:v1','registry/app:v1\n']:
            with self.assertRaises(hosted.OperationError):hosted.image_reference(value)
        self.assertEqual(hosted.image_reference('custom:v1',local=True),'custom:v1')
        self.assertEqual(hosted.registry_repository('localhost:5000/app:v1'),'localhost:5000/app')
        self.assertEqual(hosted.registry_repository('docker.io/library/app:v1'),hosted.registry_repository('library/app@sha256:'+'a'*64))

    def test_unknown_image_protocol_and_failed_download_are_actionable(self):
        with self.assertRaises(hosted.OperationError):hosted.valid_metadata({'application':'athlete-panel','hostedProtocol':2})
        metadata={'application':'athlete-panel','hostedProtocol':1,'version':'0.1.0','sourceDigest':'a'*64,'plugins':[]}
        self.assertEqual(hosted.valid_metadata(metadata),metadata)
        for commit in [123,None,'short']:
            with self.assertRaisesRegex(hosted.OperationError,'commit'):hosted.valid_metadata({**metadata,'commit':commit})
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root)
            with patch.object(hosted.subprocess,'run',return_value=hosted.subprocess.CompletedProcess([],1,'','synthetic registry secret')):
                with self.assertRaises(hosted.OperationError) as error:instance.run(['docker','pull','ghcr.io/example/app:v1'])
                self.assertIn('registry login',str(error.exception));self.assertNotIn('synthetic registry secret',str(error.exception))

    def test_custom_build_cannot_silently_become_a_registry_release(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root)
            instance.pending={'previous':{'image':'old'},'candidate':{'origin':{'kind':'registry','requested':'ghcr.io/example/app:v1'}}}
            with patch.object(instance,'console') as console:
                with self.assertRaises(hosted.OperationError):instance.validate_upgrade()
                console.assert_not_called()
                instance.pending['acceptCustomChanges']=True;instance.validate_upgrade()
                self.assertEqual(console.call_args.args[-1],'--accept-plugin-removals')

    def test_resume_does_not_pull_a_moved_tag_again(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root);image='sha256:'+'a'*64
            instance.record={'project':'athlete-panel-hosted-0123456789','database':'athlete_panel_test'}
            instance.begin('upgrade',resolvedImages={'candidate':{'image':image,'registryRef':'ghcr.io/example/app@sha256:'+'b'*64,'origin':{'kind':'registry'}}})
            commands=[]
            def run(args,**kwargs):
                commands.append(args)
                if args[1]=='create':return hosted.subprocess.CompletedProcess(args,0,'fixture-container','')
                if args[1]=='cp' and '.athlete-panel-release.json' in args[2]:
                    Path(args[3]).write_text(json.dumps({'application':'athlete-panel','hostedProtocol':1,'version':'0.1.0','sourceDigest':'c'*64,'plugins':[]}))
                return hosted.subprocess.CompletedProcess(args,0,'','')
            with patch.object(instance,'run',side_effect=run):instance.prepare_image(remote='ghcr.io/example/app:v1')
            self.assertFalse(any(command[1]=='pull' for command in commands))
            self.assertEqual(instance.pending['candidate']['image'],image)

    def test_bundle_contains_only_controller_instructions_and_pinned_reference(self):
        module_spec=importlib.util.spec_from_file_location('package_release',Path(__file__).resolve().parents[2]/'scripts/package-release.py')
        module=importlib.util.module_from_spec(module_spec)
        with patch.dict(sys.modules,{'hosted':hosted}):module_spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as root:
            output=Path(root)/'release.tar.gz';reference='ghcr.io/example/app@sha256:'+'d'*64
            module.package_release(reference,output)
            with tarfile.open(output) as archive:
                self.assertEqual(set(archive.getnames()),{'scripts/hosted.py','scripts/hosted_rehearsal.py','scripts/image_identity.py','scripts/hosted_adoption.py','release.json','README.txt'})
                self.assertEqual(json.load(archive.extractfile('release.json'))['image'],reference)
            with self.assertRaises(ValueError):module.package_release(reference,output)
            with self.assertRaises(ValueError):module.package_release('ghcr.io/example/app:v1',Path(root)/'unsafe.tar.gz')

    def test_mount_must_be_remote_and_identity_stays_stable(self):
        mounts = '1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 0:2 / /mnt/off\\040host rw - nfs4 server:/export rw'
        fs, fingerprint = hosted.mount_identity('/mnt/off host/archives', mounts)
        self.assertEqual(fs, 'nfs4'); self.assertEqual(len(fingerprint), 64)
        self.assertEqual(hosted.mount_identity('/mnt/off host/archives', mounts.split('\n')[0])[0], 'ext4')

    def test_configuration_is_data_and_state_is_private(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / '.env'; path.write_text('ENCRYPTION_KEY="$(do-not-execute)"\n'); path.chmod(0o600)
            self.assertEqual(hosted.parse_configuration(path)['ENCRYPTION_KEY'], '$(do-not-execute)')
            path.chmod(0o644)
            with self.assertRaises(hosted.OperationError): hosted.parse_configuration(path)
            hosted.write_json(Path(root) / 'record.json', {'phase':'prepared'})
            self.assertEqual((Path(root) / 'record.json').stat().st_mode & 0o777, 0o600)

    def test_interrupted_step_is_retried_completed_step_is_not(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            instance.begin('upgrade'); calls = []
            def fail(): calls.append('failed'); raise hosted.OperationError('synthetic interruption')
            with self.assertRaises(hosted.OperationError): instance.step('migrate', fail)
            resumed = hosted.Hosted(root)
            self.assertNotIn('migrate', resumed.pending['completed'])
            resumed.step('migrate', lambda: calls.append('success'))
            resumed.step('migrate', lambda: calls.append('incorrect-repeat'))
            self.assertEqual(calls, ['failed','success'])

    def test_missing_marker_cannot_become_a_local_backup(self):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root)/'storage';directory.mkdir()
            instance=hosted.Hosted(Path(root)/'state',test={'port':4443})
            instance.record={'backupDirectory':str(directory)}
            instance.register_storage();instance.verify_storage()
            (directory/'.athlete-panel-storage-id').unlink()
            with self.assertRaises(hosted.OperationError):instance.verify_storage()
            self.assertFalse((directory/'.athlete-panel-storage-id').exists())

    def test_lock_prevents_competing_operations(self):
        with tempfile.TemporaryDirectory() as root:
            one,two=hosted.Hosted(root),hosted.Hosted(root)
            with one.lock():
                with self.assertRaises(hosted.OperationError):
                    with two.lock(): pass

    def test_new_install_defaults_local_and_persists_mode_without_touching_remote_setup(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'local-backups'
            instance = hosted.Hosted(Path(root) / 'state')
            with patch.object(instance, 'resume'):
                instance.install(None, 'training.example.com', destination)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
            resumed = hosted.Hosted(instance.state)
            self.assertEqual(resumed.backup_mode(), 'local')
            with patch.object(hosted, 'mount_identity', side_effect=AssertionError('No remote mount needed')):
                resumed.register_storage(); resumed.verify_storage()
            self.assertFalse(resumed.storage_policy().exists())
            self.assertFalse(hosted.storage_marker(destination).exists())
            destination.rmdir()
            with self.assertRaisesRegex(hosted.OperationError, 'unavailable'): resumed.verify_storage()
            self.assertFalse(destination.exists())

    def test_local_requires_private_directory_and_cannot_override_existing_remote_policy(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'backups'; destination.mkdir(mode=0o700)
            instance = hosted.Hosted(Path(root) / 'state')
            instance.record = {'backupDirectory': str(destination), 'backupMode': 'local'}
            instance.verify_storage()
            destination.chmod(0o755)
            with self.assertRaisesRegex(hosted.OperationError, '0700'): instance.verify_storage()
            destination.chmod(0o700)
            hosted.private_directory(instance.storage_policy().parent)
            hosted.write_json(instance.storage_policy(), {'version': 1, 'id': 'existing-remote'})
            with self.assertRaisesRegex(hosted.OperationError, 'conflicts'): instance.verify_storage()

    def test_legacy_records_keep_remote_mode_and_missing_mount_never_falls_back(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'backups'; destination.mkdir(mode=0o700)
            instance = hosted.Hosted(Path(root) / 'state')
            instance.record = {'backupDirectory': str(destination)}
            self.assertEqual(instance.backup_mode(), 'remote')
            hosted.private_directory(instance.storage_policy().parent)
            hosted.write_json(instance.storage_policy(), {'version': 1, 'id': 'remote-id', 'mountFingerprint': 'a' * 64})
            hosted.storage_marker(destination).write_text('remote-id')
            with patch.object(hosted, 'mount_identity', return_value=('nfs4', 'a' * 64)):
                instance.verify_storage()
            before = set(destination.iterdir())
            with patch.object(hosted, 'mount_identity', return_value=('ext4', 'b' * 64)):
                with self.assertRaisesRegex(hosted.OperationError, 'absent or changed'): instance.verify_storage()
            self.assertEqual(set(destination.iterdir()), before)
            self.assertEqual(instance.backup_mode(), 'remote')

    def test_remote_install_is_explicit_and_never_creates_a_missing_destination(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'remote'
            instance = hosted.Hosted(Path(root) / 'state', test={'port':4443})
            with self.assertRaisesRegex(hosted.OperationError, 'mount'): instance.install(None, 'training.example.com', destination, backup_mode='remote')
            self.assertFalse(destination.exists()); self.assertIsNone(instance.record)
            destination.mkdir(mode=0o700)
            with patch.object(instance, 'resume'): instance.install(None, 'training.example.com', destination, backup_mode='remote')
            instance.register_storage()
            self.assertEqual(hosted.Hosted(instance.state, test={'port':4443}).backup_mode(), 'remote')

    def test_status_distinguishes_local_remote_legacy_and_failed_or_overdue_backups(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            instance.record = {'backupMode': 'local'}
            status = {'lastBackup': {'verifiedAt': hosted.timestamp(), 'storage': 'unverified'}}
            self.assertEqual(instance.backup_protection(status), 'Local backup verified; off-server copy not configured')
            self.assertIn('failed', instance.backup_protection({**status, 'backupAttempt': {'state': 'failed'}}))
            self.assertIn('overdue', instance.backup_protection({'lastBackup': {'verifiedAt': '2020-01-01T00:00:00Z'}}))
            self.assertEqual(instance.backup_protection({'lastBackup': {'verifiedAt': 'invalid'}}), 'Backup verification pending')
            instance.record = {}  # Legacy remote record never inherits the local default.
            self.assertEqual(instance.backup_protection(status), 'Off-server protection not verified')
            status['lastBackup']['storage'] = 'remote-mount'
            self.assertEqual(instance.backup_protection(status), 'Verified backup on registered remote storage')

    def test_cancel_refuses_an_ambiguous_maintenance_transition(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root);instance.begin('upgrade')
            instance.pending['phase']='validate-upgrade-source';instance.checkpoint();instance.cancel()
            self.assertIsNone(instance.pending)
            instance.begin('upgrade');instance.pending['phase']='enable-maintenance';instance.checkpoint()
            with self.assertRaises(hosted.OperationError):instance.cancel()
            self.assertTrue((Path(root)/'operation.json').exists())

    def test_fresh_install_cannot_reuse_another_owners_archive_directory(self):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root)/'storage';directory.mkdir();(directory/'retained.fgr').write_bytes(b'synthetic-archive')
            instance=hosted.Hosted(Path(root)/'state',test={'port':4443})
            with self.assertRaises(hosted.OperationError):instance.install(Path(root),'training.example.com',directory)
            self.assertIsNone(instance.record)
            self.assertEqual((directory/'retained.fgr').read_bytes(),b'synthetic-archive')

    def test_release_selection_preserves_previous_identity_when_replayed(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root);old={'image':'old'};new={'image':'new'}
            instance.record={'active':old};instance.begin('upgrade',previous=old)
            instance.select_release(new);instance.select_release(new)
            self.assertEqual(instance.record,{'active':new,'previous':old})

    def test_private_state_cannot_enter_source_or_archive_storage(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(hosted,'ROOT',Path(root)):
                with self.assertRaises(hosted.OperationError):hosted.Hosted(Path(root)/'unsafe-source-state')
            instance=hosted.Hosted(Path(root)/'state',test={'port':4443})
            with self.assertRaises(hosted.OperationError):instance.install(Path(root)/'source','training.example.com',root)
            with self.assertRaises(hosted.OperationError):instance.prepare_image(root)

    def test_failure_diagnostics_do_not_repeat_private_child_output(self):
        with tempfile.TemporaryDirectory() as root:
            instance=hosted.Hosted(root)
            with patch.object(hosted.subprocess,'run',return_value=hosted.subprocess.CompletedProcess([],2,'synthetic-secret','synthetic-secret')):
                with self.assertRaises(hosted.OperationError) as error:instance.run(['node','scripts/migrate.ts'])
                self.assertIn('committed migrations',str(error.exception));self.assertNotIn('synthetic-secret',str(error.exception))


if __name__ == '__main__': unittest.main()
