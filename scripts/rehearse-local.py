#!/usr/bin/env python3
"""Rehearse guided setup in a disposable checkout, Docker project and database. No owner .env is loaded."""
import http.client
import json
import os
from pathlib import Path
import pty
import secrets
import select
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


class HttpCheckError(RuntimeError):
    pass


def main():
    stage = Path(tempfile.mkdtemp(prefix='athlete-panel-local-check-'))
    stage.chmod(0o700)
    project = 'athlete-panel-local-check-' + secrets.token_hex(5)
    processes = []
    env = {key: value for key, value in os.environ.items() if key in {
        'PATH', 'HOME', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'PNPM_HOME',
        'PG_BIN_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'SSH_AUTH_SOCK'}}
    env['NEXT_TELEMETRY_DISABLED'] = '1'
    compose = ['docker', 'compose', '--env-file', '.env', '-p', project, '-f', 'compose.local.yml']
    def run(args, *, data=None, ok=True):
        result = subprocess.run(args, cwd=stage, env=env, input=data, text=True, capture_output=True, timeout=180)
        if ok and result.returncode: raise RuntimeError(f'{args[0]} check failed (exit {result.returncode}); raw output withheld to protect generated credentials.')
        return result
    def stop(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGINT)
            try: process.wait(timeout=50)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=10)
    def port():
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]
    def sql(query):
        return run(compose + ['exec', '-T', 'db', 'psql', '-U', 'athlete_panel', '-d', 'athlete_panel', '-Atc', query]).stdout.strip()
    def interactive_setup(cancel=False):
        master, slave = pty.openpty()
        process = subprocess.Popen(['pnpm', 'run', 'setup'], cwd=stage, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        processes.append(process); os.close(slave)
        output = ''; cursor = 0
        def until(message):
            nonlocal output, cursor
            deadline = time.monotonic() + 180
            while message not in output[cursor:]:
                if time.monotonic() > deadline: raise RuntimeError('Setup prompt timed out; raw terminal output withheld.')
                if select.select([master], [], [], .2)[0]:
                    try: chunk = os.read(master, 65536)
                    except OSError: chunk = b''
                    if not chunk: raise RuntimeError('Setup exited before the expected prompt; raw output withheld.')
                    output += chunk.decode(errors='replace')
            cursor = output.index(message, cursor) + len(message)
        def finish():
            # Drain the PTY through exit: pnpm flushes terminal state after the final line.
            nonlocal output
            deadline = time.monotonic() + 30
            while process.poll() is None:
                if time.monotonic() > deadline: raise RuntimeError('Setup did not exit after its final message.')
                if select.select([master], [], [], .1)[0]:
                    try: output += os.read(master, 65536).decode(errors='replace')
                    except OSError: break
            process.wait(timeout=5)
        try:
            until('input visible): ')
            if cancel:
                os.write(master, b'\x03'); until('Setup cancelled.'); finish()
                if process.returncode == 0: raise RuntimeError('Cancelled setup reported success.')
                return
            os.write(master, b'short\n'); until('input visible): ')
            os.write(master, (password + '\n').encode()); until('Confirm your login password (input visible): ')
            os.write(master, b'different-synthetic-password\n'); until('input visible): ')
            os.write(master, (password + '\n').encode()); until('Confirm your login password (input visible): ')
            os.write(master, (password + '\n').encode()); until('Start Athlete Panel with: pnpm run local')
            finish()
            if process.returncode != 0 or output.count(password) < 3 or 'different-synthetic-password' not in output:
                raise RuntimeError('Visible password setup failed or did not display both password entries.')
        finally:
            os.close(master); stop(process)
    try:
        print('Preparing isolated source and dependencies…', flush=True)
        for directory in ['apps', 'packages', 'plugins', 'personal-plugins', 'instance', 'scripts', 'tests', 'docs', '.agents', '.claude', '.github']:
            shutil.copytree(ROOT / directory, stage / directory, ignore=shutil.ignore_patterns('node_modules', '.next', 'dist', '__pycache__', '.env', '.env.*', '*.tsbuildinfo'))
        for name in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'compose.local.yml', 'compose.yml', 'compose.test.yml', 'Dockerfile', 'Caddyfile', '.env.example', '.dockerignore', '.gitignore', 'vitest.config.ts', 'playwright.config.ts', 'README.md', 'AGENTS.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md']:
            shutil.copyfile(ROOT / name, stage / name)
        run(['pnpm', 'install', '--offline', '--frozen-lockfile'])
        database_port, web_port = port(), port()
        while web_port == database_port: web_port = port()
        # Use the exact credential generator, selecting isolated ports/project rather than the owner defaults.
        generate = "import {createLocalConfig,newLocalConfig} from './scripts/lib/local-config.ts'; await createLocalConfig(process.cwd(),newLocalConfig(" + json.dumps({'project': project, 'databasePort': database_port, 'webPort': web_port}) + '));'
        run(['node', '--import', 'tsx', '--input-type=module', '-e', generate])
        before = (stage / '.env').read_bytes()
        password = 'Synthetic-local-' + secrets.token_hex(12)
        interactive_setup(cancel=True)
        if sql('select count(*) from host.owner') != '0': raise RuntimeError('Cancellation created an owner.')
        invalid = run(['pnpm', 'run', 'setup', '--password-stdin'], data='short\n', ok=False)
        if invalid.returncode == 0: raise RuntimeError('Short stdin password was accepted.')
        interactive_setup()
        owner_hash = sql('select password_hash from host.owner')
        run(['pnpm', 'run', 'setup'])
        if (stage / '.env').read_bytes() != before or sql('select password_hash from host.owner') != owner_hash:
            raise RuntimeError('Repeated setup replaced credentials or the owner.')
        print('Verified visible password confirmation, cancellation/resume, generated private credentials and repeated setup.', flush=True)

        origin = f'http://127.0.0.1:{web_port}'
        cookie = ''
        def request(path, payload=None, expected=200, browser_origin=None):
            nonlocal cookie
            requested_origin = browser_origin or origin
            client = http.client.HTTPConnection('127.0.0.1', web_port, timeout=20)
            try:
                client.request('POST' if payload is not None else 'GET', path, body=json.dumps(payload) if payload is not None else None,
                               headers={'Origin': requested_origin, 'Host': requested_origin.split('://', 1)[1], 'Content-Type': 'application/json', 'Cookie': cookie})
                response = client.getresponse(); body = response.read()
                if response.status != expected: raise HttpCheckError(f'HTTP check returned {response.status}, expected {expected}.')
                if response.getheader('Set-Cookie'): cookie = response.getheader('Set-Cookie').split(';')[0]
                return json.loads(body)
            finally: client.close()
        def start():
            log = open(stage / 'local.log', 'ab')
            process = subprocess.Popen(['pnpm', 'run', 'local'], cwd=stage, env=env, stdout=log, stderr=log, start_new_session=True)
            log.close(); processes.append(process)
            last_error = None
            for _ in range(90):
                if process.poll() is not None: raise RuntimeError('Local launcher exited before readiness; raw logs withheld.')
                try: request('/api/health'); return process
                except (OSError, http.client.HTTPException, HttpCheckError) as error:
                    last_error = type(error).__name__; time.sleep(1)
            raise RuntimeError(f'Local server readiness timed out ({last_error}).')
        def stopped():
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1', web_port)) == 0: raise RuntimeError('Web server survived Ctrl+C.')
            if sql("select count(*) from pg_stat_activity where usename='athlete_panel_app'") != '0':
                raise RuntimeError('An application database connection survived shutdown.')
        process = start()
        request('/api/workspace?from=2026-10-19&to=2026-10-25', expected=401)
        request('/api/auth/login', {'password': password})
        request('/api/auth/logout', {})
        localhost_origin = f'http://localhost:{web_port}'
        request('/api/auth/login', {'password': password}, browser_origin=localhost_origin)
        request('/api/workspace?from=2026-10-19&to=2026-10-25', browser_origin=localhost_origin)
        request('/api/auth/logout', {}, browser_origin=localhost_origin)
        request('/api/auth/login', {'password': password}, expected=403, browser_origin='http://untrusted.invalid')
        request('/api/auth/login', {'password': password})
        workout = str(uuid.uuid4())
        request('/api/plugins/training/mutate', {'idempotencyKey': str(uuid.uuid4()), 'commands': [{'action': 'workout.create', 'values': {'id': workout, 'title': 'Synthetic setup ride', 'sport': 'cycling', 'schedule': {'kind': 'independent', 'date': '2026-10-25'}, 'durationSeconds': 1800}}]})
        if not sql("select value from host.settings where key='worker'"): raise RuntimeError('Worker did not start.')
        if run(['pnpm', 'run', 'setup'], ok=False).returncode == 0: raise RuntimeError('Setup ignored the active launcher lock.')
        stop(process); stopped()
        process = start()
        state = request('/api/workspace?from=2026-10-19&to=2026-10-25')['state']
        if not any(item['id'] == workout for item in state['workouts']): raise RuntimeError('Local restart lost the saved workout.')
        active_guard = run(['pnpm', 'local:ops', 'maintenance', 'on'], ok=False)
        if active_guard.returncode == 0: raise RuntimeError('Local maintenance changed a running instance.')
        stop(process); stopped()
        print('Verified both localhost/127.0.0.1 logins, rejection of foreign origins, manual save, worker heartbeat, Ctrl+C cleanup and persistence after local restart.', flush=True)

        # Exercise the documented local upgrade with an actual forward migration and verified backup.
        backup_key = stage / 'backup-key'
        import base64
        backup_key.write_text(base64.b64encode(secrets.token_bytes(32)).decode()); backup_key.chmod(0o600)
        run(['pnpm', 'local:ops', 'maintenance', 'on'])
        backup_dir = stage / 'upgrade-backups'
        run(['pnpm', 'local:ops', 'backup', '--key-file', str(backup_key), '--destination', str(backup_dir)])
        archive = next(backup_dir.glob('*.fgr'))
        run(['pnpm', 'local:ops', 'maintenance', 'off'])
        unmaintained = run(['pnpm', 'local:ops', 'migrate', '--backup', str(archive), '--key-file', str(backup_key)], ok=False)
        if unmaintained.returncode == 0: raise RuntimeError('Local upgrade accepted an instance outside maintenance.')
        run(['pnpm', 'local:ops', 'maintenance', 'on'])
        wrong_key = stage / 'wrong-backup-key'; wrong_key.write_text(base64.b64encode(secrets.token_bytes(32)).decode()); wrong_key.chmod(0o600)
        rejected = run(['pnpm', 'local:ops', 'migrate', '--backup', str(archive), '--key-file', str(wrong_key)], ok=False)
        if rejected.returncode == 0: raise RuntimeError('Local upgrade accepted an unauthenticated backup.')
        forward = stage / 'plugins/athlete/migrations/999-local-rehearsal.sql'
        forward.write_text('CREATE TABLE athlete.local_upgrade_probe (id integer PRIMARY KEY);\n')
        manifest_path = stage / 'plugins/athlete/manifest.json'
        manifest = json.loads(manifest_path.read_text()); manifest['migrations'].append('migrations/999-local-rehearsal.sql')
        manifest_path.write_text(json.dumps(manifest))
        run(['pnpm', 'registry:generate'])
        run(['pnpm', 'local:ops', 'migrate', '--backup', str(archive), '--key-file', str(backup_key)])
        if sql("select value from host.settings where key='maintenance'") != 'true': raise RuntimeError('Upgrade reopened writes automatically.')
        if sql("select to_regclass('athlete.local_upgrade_probe')") != 'athlete.local_upgrade_probe': raise RuntimeError('Local forward migration did not apply.')
        run(['pnpm', 'local:ops', 'maintenance', 'off'])
        print('Verified local maintenance, encrypted backup authentication and explicit forward upgrade; writes remain closed until requested.', flush=True)

        migration = stage / 'packages/host/migrations/001-host.sql'
        original = migration.read_bytes(); migration.write_bytes(original + b'\n-- synthetic incompatible candidate\n')
        result = run(['pnpm', 'run', 'setup'], ok=False)
        if result.returncode == 0 or 'coordinated upgrade' not in result.stdout + result.stderr: raise RuntimeError('Existing schema was automatically upgraded.')
        migration.write_bytes(original)
        if sql('select password_hash from host.owner') != owner_hash: raise RuntimeError('Failed upgrade changed the owner.')
        (stage / '.env').rename(stage / '.env.rehearsal')
        result = run(['pnpm', 'run', 'setup'], ok=False)
        if result.returncode == 0 or (stage / '.env').exists(): raise RuntimeError('Missing configuration regenerated credentials for existing storage.')
        (stage / '.env.rehearsal').rename(stage / '.env')
        print('Verified schema mismatch and missing configuration refuse replacement; owner storage was never used.', flush=True)
    finally:
        for process in processes: stop(process)
        if (stage / '.env.rehearsal').exists(): (stage / '.env.rehearsal').rename(stage / '.env')
        if (stage / '.env').exists(): run(compose + ['down', '--volumes', '--remove-orphans'], ok=False)
        shutil.rmtree(stage)


if __name__ == '__main__':
    main()
