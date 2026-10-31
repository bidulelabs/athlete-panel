"""Exercise the public readiness probe against synthetic loopback HTTP responses."""
import importlib.util
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, call, patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('hosted_readiness', ROOT / 'scripts/hosted.py')
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)
IMAGE = 'sha256:' + 'a' * 64
READY = (200, 'application/json', b'{"status":"ready"}', None)


class HostedReadiness(unittest.TestCase):
    def setUp(self):
        self.responses = [READY]
        self.paths = []
        self.agents = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.paths.append(self.path)
                owner.agents.append(self.headers.get('User-Agent'))
                response = owner.responses[0] if self.path == '/api/health' else READY
                if self.path == '/api/health' and len(owner.responses) > 1:
                    owner.responses.pop(0)
                if isinstance(response, bytes):
                    self.wfile.write(response)
                    self.close_connection = True
                    return
                status, content_type, body, location = response
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                if location:
                    self.send_header('Location', location)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        self.origin = 'http://127.0.0.1:' + str(server.server_port)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.instance = hosted.Hosted(directory.name)
        self.release = {'image': IMAGE, 'metadata': {'version': '0.2.0'}}
        for target, name, kwargs in [
            (self.instance, 'origin', {'return_value': self.origin}),
            (self.instance, 'compose', {'return_value': Mock(stdout='synthetic-web')}),
            (self.instance, 'run', {'return_value': Mock(stdout=IMAGE)}),
            (hosted.time, 'sleep', {}),
        ]:
            mock = patch.object(target, name, **kwargs)
            mock.start()
            self.addCleanup(mock.stop)
        worker = patch.object(self.instance, 'fresh_worker')
        self.worker = worker.start()
        self.addCleanup(worker.stop)

    def check(self):
        self.instance.running_health(self.release, 'synthetic-start-time')

    def test_descriptive_user_agent_uses_only_a_safe_release_version(self):
        for version, expected in [
            ('0.2.0', 'AthletePanelDeployment/0.2.0'),
            ('0.3.0-beta.1+custom', 'AthletePanelDeployment/0.3.0-beta.1+custom'),
            ('', 'AthletePanelDeployment'),
            ('custom build (private)', 'AthletePanelDeployment'),
            ('0.2.0\r\nX-Secret: private', 'AthletePanelDeployment'),
            ('x' * 129, 'AthletePanelDeployment'),
            (None, 'AthletePanelDeployment'),
        ]:
            with self.subTest(version=version):
                self.release['metadata']['version'] = version
                self.check()
                self.assertEqual(self.agents[-1], expected)
        self.release.pop('metadata')
        self.check()
        self.assertEqual(self.agents[-1], 'AthletePanelDeployment')

    def test_ready_json_allows_existing_synthetic_marker(self):
        for body in [b'{"status":"ready"}', b'{"status":"ready","testInstance":"isolated-synthetic"}']:
            with self.subTest(body=body):
                self.responses = [(200, 'application/json; charset=utf-8', body, None)]
                self.check()
        self.assertEqual(self.paths, ['/api/health'] * 2)
        self.worker.assert_called_with(self.release, 'synthetic-start-time')
        self.assertEqual(self.worker.call_count, 2)

    def test_public_probe_preserves_verified_tls_context_and_request_timeout(self):
        contexts = []
        default_context = hosted.ssl.create_default_context
        def context(*args, **kwargs):
            value = default_context(*args, **kwargs); contexts.append(value); return value
        with patch.object(hosted.ssl, 'create_default_context', side_effect=context), patch.object(
            hosted.urllib.request.OpenerDirector, 'open', autospec=True, side_effect=hosted.urllib.request.OpenerDirector.open
        ) as opened:
            self.check()
        self.assertTrue(contexts)
        self.assertTrue(all(value.check_hostname and value.verify_mode == hosted.ssl.CERT_REQUIRED for value in contexts))
        self.assertEqual(opened.call_args.kwargs['timeout'], 5)

    def test_wrong_web_image_is_rejected_before_public_or_worker_checks(self):
        self.instance.run.return_value.stdout = 'sha256:' + 'b' * 64
        with patch.object(self.instance, 'image_matches', return_value=False):
            with self.assertRaisesRegex(hosted.OperationError, 'selected web service is not running'):
                self.check()
        self.assertEqual(self.paths, [])
        self.worker.assert_not_called()

    def test_unrelated_or_invalid_responses_never_reach_worker_readiness(self):
        cases = [
            (200, 'text/html', b'<html>Unrelated website</html>', None),
            (200, 'text/html', b'{"status":"ready"}', None),
            (200, 'application/json', b'<html>Unrelated website</html>', None),
            (200, 'application/json', b'{"status":', None),
            (200, 'application/json', b'\xff', None),
            (200, 'application/json', b'{"status":"unavailable"}', None),
            (200, 'application/json', b'{}', None),
            (200, 'application/json', b'[ {"status":"ready"} ]', None),
            (200, 'application/json', b'null', None),
            (200, 'application/json', b'"ready"', None),
            (200, 'application/json', b'{"status":"ready","extra":"' + b'x' * 4096 + b'"}', None),
            (201, 'application/json', b'{"status":"ready"}', None),
            (503, 'application/json', b'{"status":"ready"}', None),
        ]
        for response in cases:
            with self.subTest(response=response[:2], body=response[2][:50]):
                self.paths.clear()
                self.responses = [response]
                with self.assertRaisesRegex(hosted.OperationError, 'HTTPS readiness failed'):
                    self.check()
                self.assertEqual(self.paths, ['/api/health'] * 60)
                self.worker.assert_not_called()

    def test_redirects_are_rejected_without_contacting_the_target(self):
        # The target deliberately returns valid readiness; following it would be a false success.
        for status in [301, 302, 303, 307, 308]:
            for location in ['/unrelated', self.origin.replace('127.0.0.1', 'localhost') + '/unrelated']:
                with self.subTest(status=status, location=location):
                    self.paths.clear()
                    self.responses = [(status, 'application/json', b'{"status":"ready"}', location)]
                    with self.assertRaisesRegex(hosted.OperationError, 'without redirects'):
                        self.check()
                    self.assertEqual(self.paths, ['/api/health'] * 60)
                    self.worker.assert_not_called()

    def test_retry_waits_for_real_readiness_before_checking_worker(self):
        self.responses = [
            (503, 'application/json', b'{"status":"unavailable"}', None),
            (200, 'text/html', b'<html>Wrong endpoint</html>', None),
            (302, 'text/html', b'', '/unrelated'),
            READY,
        ]
        self.check()
        self.assertEqual(self.paths, ['/api/health'] * 4)
        self.worker.assert_called_once_with(self.release, 'synthetic-start-time')

    def test_malformed_http_retries_without_exposing_response_details(self):
        self.responses = [b'HELLO https://private.invalid/secret-token\r\n\r\n']
        with self.assertRaisesRegex(hosted.OperationError, 'HTTPS readiness failed') as result:
            self.check()
        self.assertEqual(self.paths, ['/api/health'] * 60)
        for private in ['HELLO', 'private.invalid', 'secret-token']:
            self.assertNotIn(private, str(result.exception))
        self.worker.assert_not_called()

    def test_malformed_http_can_recover_to_valid_readiness(self):
        self.responses = [b'HELLO\r\n\r\n', READY]
        self.check()
        self.assertEqual(self.paths, ['/api/health'] * 2)
        self.worker.assert_called_once_with(self.release, 'synthetic-start-time')

    def test_http_rejection_reports_status_without_private_response_details(self):
        for status in [401, 403, 503]:
            with self.subTest(status=status):
                self.responses = [(status, 'text/html', b'private-body credentials=secret', '/private-token')]
                with self.assertRaisesRegex(hosted.OperationError, f'HTTP {status}') as result:
                    self.check()
                message = str(result.exception)
                for private in [self.origin, 'private-body', 'credentials', 'secret', 'private-token']:
                    self.assertNotIn(private, message)
                if status == 403:
                    self.assertIn('Forbidden', message)
                    self.assertIn('proxy', message)
                self.worker.assert_not_called()

    def upgrade_fixture(self, stack):
        previous = {'image': 'previous-image', 'metadata': {'version': '0.1.0'}}
        self.instance.record = {'active': previous, 'backupDirectory': str(self.instance.state), 'domain': 'synthetic.invalid'}
        def prepare(): self.instance.pending['candidate'] = self.release
        mocks = {}
        for name in ['docker_ready', 'reconcile_commands', 'verify_storage', 'validate_upgrade',
                     'rehearsal', 'maintenance', 'drain_work', 'console', 'start_backups', 'await_backup']:
            mocks[name] = stack.enter_context(patch.object(self.instance, name))
        stack.enter_context(patch.object(self.instance, 'prepare_candidate', side_effect=prepare))
        stack.enter_context(patch.object(self.instance, 'backup', return_value={'file': 'synthetic.fgr', 'verified': True}))
        stack.enter_context(patch.object(self.instance, 'ready', side_effect=lambda release: self.instance.running_health(release, 'synthetic-start-time')))
        return previous, mocks

    def test_upgrade_403_fails_before_maintenance_and_successful_resume_checks_candidate(self):
        with ExitStack() as stack:
            previous, mocks = self.upgrade_fixture(stack)
            self.responses = [(403, 'text/html', b'private proxy rejection', None)]
            with self.assertRaisesRegex(hosted.OperationError, 'HTTP 403'):
                self.instance.upgrade(local_image=IMAGE)
            self.assertEqual(self.instance.pending['phase'], 'verify-current-https')
            self.assertNotIn('maintenanceStartedAt', self.instance.pending)
            for name in ['maintenance', 'drain_work', 'console', 'start_backups']:
                mocks[name].assert_not_called()
            self.instance.compose.assert_not_called()
            self.worker.assert_not_called()
            self.assertEqual(self.agents, ['AthletePanelDeployment/0.1.0'] * 60)

            # Reload the failed operation and exercise both checks through the same
            # real HTTP client, including candidate image/fresh-worker verification.
            self.instance.pending = hosted.read_json(self.instance.state / 'operation.json')
            self.responses = [READY]
            self.instance.resume()
            self.assertEqual(self.agents[-2:], ['AthletePanelDeployment/0.1.0', 'AthletePanelDeployment/0.2.0'])
            self.assertEqual(mocks['maintenance'].call_args_list, [call(previous, True), call(self.release, False)])
            self.worker.assert_called_once_with(self.release, 'synthetic-start-time')
            self.assertEqual(self.instance.record['active'], self.release)
            self.assertIsNone(self.instance.pending)

    def test_rejected_upgrade_preflight_can_be_cancelled(self):
        with ExitStack() as stack:
            previous, mocks = self.upgrade_fixture(stack)
            self.responses = [(403, 'text/html', b'', None)]
            with self.assertRaises(hosted.OperationError): self.instance.upgrade(local_image=IMAGE)
            self.instance.cancel()
            mocks['maintenance'].assert_not_called()
            self.assertEqual(self.instance.record['active'], previous)
            self.assertIsNone(self.instance.pending)


if __name__ == '__main__':
    unittest.main()
