#!/usr/bin/env python3
"""Disposable production-image rehearsal. Never loads the owner's .env or database."""
import argparse
import base64
import http.client
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
REDACTIONS = []


def run(args, *, data=None, env=None, ok=True):
    result = subprocess.run(args, input=data, text=True, capture_output=True, env=env, cwd=ROOT, timeout=1800 if args[:2] == ['docker','build'] else 600)
    if ok and result.returncode:
        # This harness handles synthetic data only; redact generated credentials anyway.
        diagnostic = (result.stderr + '\n' + result.stdout)[-5000:]
        for value in REDACTIONS: diagnostic = diagnostic.replace(value, '[redacted]')
        raise RuntimeError(f'{args[0]} operation failed (exit {result.returncode}):\n{diagnostic}')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', help='Use an already built local image; otherwise build a unique one')
    args = parser.parse_args()
    project = 'athlete-panel-check-' + secrets.token_hex(5)
    image = args.image or project + ':candidate'
    stage = Path(tempfile.mkdtemp(prefix=project + '-'))
    os.chmod(stage, 0o700)
    compose = None
    try:
        backup_dir = stage / 'backups'; backup_dir.mkdir()
        recovery_dir = stage / 'recovery'; recovery_dir.mkdir()
        key = stage / 'backup-key'; key.write_text(base64.b64encode(secrets.token_bytes(32)).decode()); key.chmod(0o600)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        admin_password, app_password = secrets.token_hex(32), secrets.token_hex(32)
        env = dict(os.environ)
        # Explicitly replace every interpolated setting; never load the working .env.
        env.update(POSTGRES_PASSWORD=admin_password, APP_DATABASE_PASSWORD=app_password,
                   POSTGRES_DB='rehearsal_test', ATHLETE_PANEL_DOMAIN='localhost', ATHLETE_PANEL_RELEASE='rehearsal',
                   ENCRYPTION_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),
                   BACKUP_KEY_FILE=str(key), BACKUP_DESTINATION=str(backup_dir), BACKUP_HOUR_UTC='3')
        REDACTIONS.extend([admin_password, app_password, env['ENCRYPTION_KEY'], key.read_text()])
        empty_env = stage / 'empty.env'; empty_env.touch()
        config = json.loads(run(['docker', 'compose', '--env-file', str(empty_env), '-p', project, '-f', str(ROOT / 'compose.yml'), '--profile', 'backup', '--profile', 'tools', 'config', '--format', 'json'], env=env).stdout)
        config['name'] = project
        # Compose expands volume names using the selected isolated project name.
        for definition in config.get('volumes', {}).values():
            if definition.get('name', '').startswith('athlete-panel_'):
                raise RuntimeError('Refusing non-isolated volume mapping.')
        origin = f'https://localhost:{port}'
        for name in ['web', 'worker', 'backup', 'admin', 'recovery']:
            service = config['services'][name]
            service['image'] = image; service.pop('build', None)
            service['environment']['APP_ORIGIN'] = origin
        config['services']['caddy']['ports'] = [{'target': 443, 'published': str(port), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        caddy = stage / 'Caddyfile'
        caddy.write_text((ROOT / 'Caddyfile').read_text().replace('{$ATHLETE_PANEL_DOMAIN} {', 'localhost {\n    tls internal'))
        for volume in config['services']['caddy']['volumes']:
            if volume['target'] == '/etc/caddy/Caddyfile': volume['source'] = str(caddy)
        config['services']['recovery']['volumes'].append({'type': 'bind', 'source': str(recovery_dir), 'target': '/recovery'})
        config_file = stage / 'compose.json'; config_file.write_text(json.dumps(config)); config_file.chmod(0o600)
        compose = ['docker', 'compose', '-p', project, '-f', str(config_file)]
        if not args.image:
            print('Building the production image…', flush=True)
            run(['docker', 'build', '-t', image, '.'])
        run(compose + ['up', '-d', '--wait', 'db'])
        run(compose + ['run', '--rm', '--no-deps', 'admin', 'pnpm', '--version'])
        run(compose + ['run', '--rm', '--no-deps', 'admin', 'pnpm', 'db:migrate'])
        password = 'synthetic-' + secrets.token_hex(18)
        REDACTIONS.append(password)
        run(compose + ['run', '--rm', '--no-deps', '-T', 'admin', 'pnpm', 'run', 'owner', 'bootstrap', '--password-stdin'], data=password + '\n')
        run(compose + ['up', '-d', '--wait', 'web', 'worker', 'caddy'])
        caddy_id = run(compose + ['ps', '-q', 'caddy']).stdout.strip()
        certificate = stage / 'ca.crt'
        for _ in range(30):
            if run(['docker', 'cp', caddy_id + ':/data/caddy/pki/authorities/local/root.crt', str(certificate)], ok=False).returncode == 0: break
            time.sleep(1)
        context = ssl.create_default_context(cafile=str(certificate))
        cookie = ''
        def request(path, payload=None, expected=200, spoof_address=None):
            nonlocal cookie
            connection = http.client.HTTPSConnection('localhost', port, context=context, timeout=20)
            try:
                headers = {'Origin': origin, 'Content-Type': 'application/json', 'Cookie': cookie}
                if spoof_address: headers['X-Athlete-Panel-Client-IP'] = spoof_address
                connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None, headers)
                response = connection.getresponse()
                body = response.read()
                if response.status != expected: raise RuntimeError(f'Synthetic HTTP check failed: {path} returned {response.status}, expected {expected}')
                if response.getheader('Set-Cookie'):
                    value = response.getheader('Set-Cookie')
                    if 'Secure' not in value or 'HttpOnly' not in value: raise RuntimeError('Session cookie flags missing')
                    cookie = value.split(';')[0]
                return json.loads(body)
            finally: connection.close()
        request('/api/health')
        request('/api/workspace?from=2026-10-19&to=2026-10-25', expected=401)
        request('/api/auth/login', {'password': password})
        workout_id = str(uuid.uuid4())
        request('/api/plugins/training/mutate', {'idempotencyKey': str(uuid.uuid4()), 'commands': [{'action': 'workout.create', 'values': {'id': workout_id, 'title': 'Synthetic release ride', 'sport': 'cycling', 'schedule': {'kind': 'independent', 'date': '2026-10-25'}, 'durationSeconds': 3600}}]})
        def persisted():
            state = request('/api/workspace?from=2026-10-19&to=2026-10-25')['state']
            if not any(item['id'] == workout_id for item in state['workouts']): raise RuntimeError('Restart lost synthetic workout')
        persisted()
        def sql(query, database='rehearsal_test'):
            return run(compose + ['exec', '-T', 'db', 'psql', '-U', 'athlete_panel', '-d', database, '-Atc', query]).stdout.strip()
        if sql("select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls from pg_roles where rolname='athlete_panel_app'") != 'f': raise RuntimeError('Runtime role is privileged')
        spoof = '203.0.113.7'
        request('/api/auth/login', {'password': 'synthetic-incorrect-password'}, expected=401, spoof_address=spoof)
        spoof_key = 'client:' + hashlib.sha256(spoof.encode()).hexdigest()
        if sql(f"select count(*) from host.login_attempts where key='{spoof_key}'") != '0': raise RuntimeError('Client spoofed the proxy identity')
        for service in ['web', 'worker']:
            container = run(compose + ['ps', '-q', service]).stdout.strip()
            values = json.loads(run(['docker', 'inspect', container]).stdout)[0]['Config']['Env']
            if any(value.startswith(('ADMIN_DATABASE_URL=', 'POSTGRES_PASSWORD=', 'APP_DATABASE_PASSWORD=')) for value in values): raise RuntimeError('Administrative secret leaked to runtime')
        run(compose + ['restart', 'db', 'web', 'worker'])
        run(compose + ['up', '-d', '--wait', 'db', 'web', 'worker'])
        persisted()
        run(compose + ['run', '--rm', '--no-deps', 'worker', 'pnpm', 'ops', 'worker-health'])
        print('Verified HTTPS with certificate validation, owner bootstrap, restricted roles and persistence after restart.', flush=True)
        run(compose + ['run', '--rm', '--no-deps', 'backup', 'pnpm', 'backup'])
        archives = list(backup_dir.glob('*.fgr'))
        if len(archives) != 1: raise RuntimeError('Expected one completed encrypted backup')
        run(compose + ['exec', '-T', 'db', 'createdb', '-U', 'athlete_panel', 'restored_test'])
        recovery_url = f'postgresql://athlete_panel:{admin_password}@db:5432/restored_test'
        restore = compose + ['run', '--rm', '--no-deps', '-e', 'DATABASE_URL=' + recovery_url]
        bad = run(restore + ['-e', 'BACKUP_KEY_FILE=/missing', 'recovery', 'pnpm', 'restore', '/backups/' + archives[0].name, '--confirm-replace', '--source-dir', '/recovery/rejected'], ok=False)
        if bad.returncode == 0 or sql("select count(*) from information_schema.tables where table_schema='host'", 'restored_test') != '0': raise RuntimeError('Missing key did not fail safely')
        run(restore + ['recovery', 'pnpm', 'restore', '/backups/' + archives[0].name, '--confirm-replace', '--source-dir', '/recovery/matched-source'])
        if sql(f"select count(*) from training.records where id='{workout_id}'", 'restored_test') != '1': raise RuntimeError('Restored workout missing')
        if sql('select count(*) from host.sessions', 'restored_test') != '0': raise RuntimeError('Restore retained sessions')
        damaged = stage / 'damaged.sql'; damaged.write_text((ROOT / 'packages/host/migrations/001-host.sql').read_text() + '\n-- synthetic incompatible candidate\n')
        result = run(compose + ['run', '--rm', '--no-deps', '-v', str(damaged) + ':/app/packages/host/migrations/001-host.sql:ro', 'admin', 'pnpm', 'db:migrate'], ok=False)
        if result.returncode == 0: raise RuntimeError('Changed applied migration was accepted')
        run(compose + ['run', '--rm', '--no-deps', 'web', 'pnpm', 'ops', 'verify-schema'])
        persisted()
        print('Verified encrypted restore into a separate database, missing-key rejection, session revocation and failed-candidate rejection.', flush=True)
        print('External DNS/public certificates, actual off-host storage and a second physical server remain operator acceptance checks.', flush=True)
    finally:
        if compose:
            # Restored sources are deliberately mode 0700/0600 and root-owned on Linux.
            # Remove only this harness's mounted recovery children before removing containers.
            if recovery_dir.exists() and any(recovery_dir.iterdir()):
                run(compose + ['run', '--rm', '--no-deps', 'recovery', 'node', '-e', "const fs=require('fs'); for(const name of fs.readdirSync('/recovery')) fs.rmSync('/recovery/'+name,{recursive:true,force:true});"], ok=False)
            run(compose + ['down', '--volumes', '--remove-orphans'], ok=False)
        shutil.rmtree(stage, ignore_errors=True)
        if not args.image: run(['docker', 'image', 'rm', image], ok=False)


if __name__ == '__main__':
    main()
