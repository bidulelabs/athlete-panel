"""Exercise the public readiness probe against synthetic loopback HTTP responses."""
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch


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
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.paths.append(self.path)
                response = owner.responses[0] if self.path == '/api/health' else READY
                if self.path == '/api/health' and len(owner.responses) > 1:
                    owner.responses.pop(0)
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
        self.instance.running_health({'image': IMAGE}, 'synthetic-start-time')

    def test_ready_json_allows_existing_synthetic_marker(self):
        for body in [b'{"status":"ready"}', b'{"status":"ready","testInstance":"isolated-synthetic"}']:
            with self.subTest(body=body):
                self.responses = [(200, 'application/json; charset=utf-8', body, None)]
                self.check()
        self.assertEqual(self.paths, ['/api/health'] * 2)
        self.worker.assert_called_with({'image': IMAGE}, 'synthetic-start-time')
        self.assertEqual(self.worker.call_count, 2)

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
        self.worker.assert_called_once_with({'image': IMAGE}, 'synthetic-start-time')


if __name__ == '__main__':
    unittest.main()
