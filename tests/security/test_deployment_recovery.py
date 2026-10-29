"""Failure boundaries for the controller and exact-image CI handoff; no real services."""
import importlib.util
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


hosted = module('hosted', 'hosted.py')
ci = module('release_ci', 'release-ci.py')
rehearsal = module('hosted_rehearsal', 'hosted_rehearsal.py')
COMMIT = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64


class DeploymentRecovery(unittest.TestCase):
    def test_lock_reloads_completed_operation_instead_of_using_stale_state(self):
        with tempfile.TemporaryDirectory() as root:
            first, later = hosted.Hosted(root), hosted.Hosted(root)
            with first.lock(): first.begin('upgrade')
            with later.lock():
                self.assertEqual(later.pending['id'], first.pending['id'])
                with self.assertRaises(hosted.OperationError): later.begin('upgrade')

    def test_each_failed_attempt_and_success_has_durable_timing(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root); instance.begin('upgrade')
            with self.assertRaises(RuntimeError): instance.step('migrate', Mock(side_effect=RuntimeError()))
            resumed = hosted.Hosted(root); resumed.step('migrate', lambda: None)
            attempts = resumed.pending['attempts']
            self.assertEqual([item['state'] for item in attempts], ['failed', 'succeeded'])
            self.assertTrue(all(item['seconds'] >= 0 and item['finishedAt'] >= item['startedAt'] for item in attempts))

    def test_uninterrupted_backup_does_not_authenticate_twice(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root); instance.record = {'active': {'image': IMAGE}}
            with patch.object(instance, 'verify_storage'), patch.object(instance, 'verify_archive') as authenticate, patch.object(instance, 'console', return_value='{"file":"fixture.fgr","verified":true}'):
                self.assertTrue(instance.backup()['verified']); authenticate.assert_not_called()

    def test_resume_after_reopening_retries_only_backup(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root); candidate = {'image': IMAGE}
            instance.record = {'active': candidate}; instance.begin('upgrade', candidate=candidate)
            instance.pending['completed'] = ['reopen-application']
            with patch.object(instance, 'docker_ready'), patch.object(instance, 'reconcile_commands'), patch.object(instance, 'verify_deployed') as verify, patch.object(instance, 'start_backups') as start, patch.object(instance, 'await_backup') as wait, patch.object(instance, 'ready') as ready, patch.object(instance, 'console') as console:
                instance.resume()
                start.assert_called_once_with(candidate); wait.assert_called_once_with(candidate)
                verify.assert_called_once_with(candidate)
                ready.assert_not_called(); console.assert_not_called(); self.assertIsNone(instance.pending)

    def test_backup_attempt_from_another_release_does_not_satisfy_readiness(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root); candidate = {'image': IMAGE, 'backupRun': 'new'}
            instance.begin('upgrade', backupStartedAt='2026-10-29T10:00:00.000Z')
            stale = {'backupAttempt': {'startedAt': '2026-10-29T11:00:00.000Z', 'runId': 'old', 'state': 'succeeded'}, 'lastBackup': {'completedAt': '2026-10-29T11:00:00.000Z', 'verifiedAt': 'now', 'kind': 'daily'}}
            failed = {'backupAttempt': {'startedAt': '2026-10-29T11:00:00.000Z', 'runId': 'new', 'state': 'failed'}}
            with patch.object(instance, 'compose', return_value=Mock(stdout='container')), patch.object(instance, 'run', return_value=Mock(stdout=IMAGE)), patch.object(instance, 'backup_status', side_effect=[stale, failed]) as status, patch.object(hosted.time, 'sleep'):
                with self.assertRaisesRegex(hosted.OperationError, 'Application deployed, backup failed'): instance.await_backup(candidate)
                self.assertEqual(status.call_count, 2)

    def test_worker_must_be_candidate_and_report_after_start(self):
        with tempfile.TemporaryDirectory() as root:
            instance = hosted.Hosted(root)
            with patch.object(instance, 'compose', return_value=Mock(stdout='worker')), patch.object(instance, 'run', return_value=Mock(stdout=IMAGE)), patch.object(instance, 'backup_status', side_effect=[{'worker': {'lastSeen': '2026-01-01', 'state': 'healthy'}}, {'worker': {'lastSeen': '2026-10-30', 'state': 'maintenance'}}]) as status, patch.object(hosted.time, 'sleep'):
                instance.fresh_worker({'image': IMAGE}, '2026-10-29'); self.assertEqual(status.call_count, 2)

    def test_interruptions_at_deployment_boundaries_keep_final_snapshot_and_do_not_repeat_sql(self):
        for boundary in ['verify-pre-upgrade-backup', 'apply-migrations', 'verify-https-and-services', 'select-active-release', 'reopen-application', 'start-scheduled-backups']:
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as root, ExitStack() as stack:
                instance = hosted.Hosted(root)
                previous, candidate = {'image': 'old'}, {'image': IMAGE}
                instance.record = {'active': previous, 'backupDirectory': root, 'domain': 'synthetic.invalid'}
                instance.begin('upgrade', previous=previous, candidate=candidate)
                state = {'revision': 1, 'migrations': 0, 'maintenance': False, 'backups': []}
                def backup(_):
                    value = {'file': 'snapshot-' + str(state['revision']) + '.fgr', 'verified': True}
                    state['backups'].append(value); return value
                def console(_release, _service, script, *args, **kwargs):
                    if script == 'scripts/migrate.ts': state['migrations'] = 1  # Existing checksummed journal.
                def maintenance(_release, enabled): state['maintenance'] = enabled
                for method in ['docker_ready', 'reconcile_commands', 'verify_storage', 'prepare_candidate', 'validate_upgrade', 'drain_work', 'compose', 'verify_archive', 'ready', 'verify_deployed', 'start_backups', 'await_backup']:
                    stack.enter_context(patch.object(instance, method))
                stack.enter_context(patch.object(instance, 'backup', side_effect=backup))
                stack.enter_context(patch.object(instance, 'console', side_effect=console))
                stack.enter_context(patch.object(instance, 'maintenance', side_effect=maintenance))
                stack.enter_context(patch.object(instance, 'rehearsal', side_effect=lambda *args: state.update(revision=2)))
                original = instance.step; interrupted = False
                def step(name, action):
                    def run():
                        nonlocal interrupted
                        action()
                        if name == boundary and not interrupted:
                            interrupted = True; raise RuntimeError('Interrupted after side effect, before completion checkpoint')
                    original(name, run)
                instance.step = step
                with self.assertRaises(RuntimeError): instance.resume()
                self.assertEqual(instance.pending['preparationBackup']['file'], 'snapshot-1.fgr')
                self.assertEqual(instance.pending['backup']['file'], 'snapshot-2.fgr')
                self.assertTrue(state['maintenance'] or boundary in ['reopen-application', 'start-scheduled-backups'])
                # Simulate a new controller reading the durable record, retaining only fake services.
                instance.pending = hosted.read_json(Path(root) / 'operation.json')
                instance.resume()
                self.assertEqual(state['migrations'], 1); self.assertFalse(state['maintenance'])
                self.assertEqual(instance.record['active']['image'], IMAGE)
                self.assertIsNone(instance.pending)

    def test_cleanup_refuses_unlabelled_resources(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, {'hosted': hosted}):
            instance = hosted.Hosted(root)
            with patch.object(instance, 'run', side_effect=[Mock(stdout='unrelated'), Mock(stdout='[{"Config":{"Labels":{}}}]')]) as run:
                with self.assertRaisesRegex(hosted.OperationError, 'label mismatch'): rehearsal.cleanup(instance, 'a' * 32)
                self.assertEqual(run.call_count, 2)

    def test_cleanup_rejects_directory_escape_before_docker(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, {'hosted': hosted}):
            instance = hosted.Hosted(root)
            with patch.object(instance, 'run') as run:
                with self.assertRaises(hosted.OperationError): rehearsal.cleanup(instance, '../../owner')
                run.assert_not_called()


class ExactImage(unittest.TestCase):
    def candidate(self, root):
        directory = Path(root); (directory / 'image.tar').write_bytes(b'synthetic image')
        record = {'format': 1, 'commit': COMMIT, 'imageId': IMAGE, 'sha256': ci.checksum(directory / 'image.tar'), 'metadata': {'commit': COMMIT, 'version': '1.0.0', 'sourceDigest': 'c' * 64}}
        (directory / 'candidate.json').write_text(json.dumps(record)); return directory, record

    def test_corrupt_archive_fails_before_docker_load(self):
        with tempfile.TemporaryDirectory() as root:
            directory, _ = self.candidate(root); (directory / 'image.tar').write_bytes(b'corrupt')
            with patch.object(ci, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'checksum'): ci.verify_image(directory, COMMIT)
                run.assert_not_called()

    def test_loaded_image_must_match_identity_platform_and_commit(self):
        with tempfile.TemporaryDirectory() as root:
            directory, record = self.candidate(root)
            info = {'Id': IMAGE, 'Os': 'linux', 'Architecture': 'amd64'}
            with patch.object(ci, 'run'), patch.object(ci, 'inspect', return_value=info), patch.object(ci, 'read_metadata', return_value=record['metadata']):
                self.assertEqual(ci.verify_image(directory, COMMIT), record)
                for field, wrong in [('Id', 'other'), ('Architecture', 'arm64')]:
                    with patch.object(ci, 'inspect', return_value={**info, field: wrong}):
                        with self.assertRaises(ValueError): ci.verify_image(directory, COMMIT)
                with self.assertRaises(ValueError): ci.verify_image(directory, 'c' * 40)

    def test_registry_auth_failure_is_not_treated_as_missing_tag(self):
        with patch.object(ci.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'unauthorized: token not found')):
            with self.assertRaises(ValueError): ci.remote_image('ghcr.io/example/app:v1')

    def test_publication_refuses_replacing_existing_image_before_any_push(self):
        with tempfile.TemporaryDirectory() as root:
            directory, record = self.candidate(root)
            for kind in ['release', 'hosted', 'hosted-registry']:
                (directory / (kind + '.json')).write_text(json.dumps({'commit': COMMIT, 'imageId': IMAGE, 'result': 'succeeded'}))
            with patch.object(ci, 'verify_image', return_value=record), patch.object(ci, 'run', return_value=COMMIT) as run, patch.object(ci, 'existing_release', return_value=None), patch.object(ci, 'remote_image', return_value={'Id': 'different'}):
                with self.assertRaisesRegex(ValueError, 'different image'): ci.publish(directory, COMMIT, 'bidulelabs/athlete-panel', 'v1.0.0', directory)
                self.assertEqual(run.call_count, 1)

    def test_gates_and_publication_permissions_preserve_existing_ci_contract(self):
        workflow = (ROOT / '.github/workflows/verify.yml').read_text()
        self.assertEqual(workflow.count("contains(needs.*.result, 'skipped')"), 2)
        self.assertIn('github.event.pull_request.number || github.run_id', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertEqual(workflow.count('packages: write'), 1)
        self.assertEqual(workflow.count('contents: write'), 1)
        self.assertIn('needs: [verify, publication-security, container-installation, container-build]', workflow)
        self.assertIn('project: [desktop, mobile]', workflow)

    def test_publication_retry_preserves_original_assets_and_never_rebuilds(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(sys.modules, {'hosted': hosted}):
            directory, record = self.candidate(root)
            for kind in ['release', 'hosted', 'hosted-registry']:
                (directory / (kind + '.json')).write_text(json.dumps({'commit': COMMIT, 'imageId': IMAGE, 'result': 'succeeded', 'seconds': 1}))
            digest = 'ghcr.io/bidulelabs/athlete-panel@sha256:' + 'd' * 64
            remote = {'Id': IMAGE, 'RepoDigests': [digest]}
            assets, commands = {}, []
            def run(args, **kwargs):
                commands.append([str(arg) for arg in args])
                if args[0] == 'git': return COMMIT
                if args[:3] == ['gh', 'release', 'create']:
                    for name in ['athlete-panel-deploy.tgz', 'athlete-panel-deploy.tgz.sha256', 'release-record.json', 'verification.json']:
                        path = next(Path(arg) for arg in args if str(arg).endswith('/' + name))
                        assets[name] = path.read_bytes()
                if args[:3] == ['gh', 'release', 'download']:
                    name = args[args.index('--pattern') + 1]
                    (Path(args[args.index('--dir') + 1]) / name).write_bytes(assets[name])
                return ''
            with patch.object(ci, 'verify_image', return_value=record), patch.object(ci, 'run', side_effect=run), patch.object(ci, 'read_metadata', return_value=record['metadata']), patch.object(ci, 'inspect', return_value=remote), patch.object(ci, 'existing_release', return_value=None) as release, patch.object(ci, 'remote_image', side_effect=[None, None, remote]) as registry:
                ci.publish(directory, COMMIT, 'bidulelabs/athlete-panel', 'v1.0.0', directory)
                self.assertEqual(len(assets), 4)
                self.assertFalse(any(command[:2] == ['docker', 'build'] for command in commands))
                commands.clear(); original = dict(assets)
                release.return_value = {'isDraft': False, 'assets': [{'name': name} for name in assets]}
                registry.side_effect = None; registry.return_value = remote
                # Fresh timing evidence must not overwrite the first successful report.
                for path in directory.glob('hosted*.json'):
                    report = json.loads(path.read_text()); report['seconds'] = 2; path.write_text(json.dumps(report))
                ci.publish(directory, COMMIT, 'bidulelabs/athlete-panel', 'v1.0.0', directory)
                self.assertEqual(assets, original)
                self.assertFalse(any(command[:2] == ['docker', 'push'] or command[:3] in [['gh', 'release', 'upload'], ['gh', 'release', 'edit']] for command in commands))
                assets['athlete-panel-deploy.tgz'] = b'conflicting publication'
                with self.assertRaisesRegex(ValueError, 'asset differs'):
                    ci.publish(directory, COMMIT, 'bidulelabs/athlete-panel', 'v1.0.0', directory)


if __name__ == '__main__': unittest.main()
