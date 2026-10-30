#!/usr/bin/env python3
"""Real adoption/upgrade/recovery on disposable synthetic Compose projects only."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
import uuid

from hosted import Hosted, OperationError, ROOT, timestamp, write_json
from hosted_adoption import adopt, project_command, reconcile, fingerprint, inspect as inspect_adoption, changed_fields

spec = importlib.util.spec_from_file_location('rehearse_hosted', ROOT / 'scripts/rehearse-hosted.py')
helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)


def scenario(image, candidate, ingress, reports):
    # Exercise legacy registered remote storage and unregistered local adoption
    # in the existing two ingress scenarios, without adding another image build.
    backup_mode = 'remote' if ingress == 'caddy' else 'local'
    stage = Path(tempfile.mkdtemp(prefix='athlete-panel-adoption-test-')); stage.chmod(0o700)
    project = 'athlete-panel-adoption-' + secrets.token_hex(5)
    port = helpers.free_port(); context = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
    test = {'port': port, 'platform': 'linux/amd64'}
    fixture = Hosted(stage / 'fixture-controller', test=test)
    roles = {'web': 'dashboard', 'worker': 'jobs', 'db': 'postgres', 'backup': 'archives', 'admin': 'admin', 'recovery': 'recovery', 'caddy': 'gateway'}
    config_path = stage / 'manual.json'; env_path = stage / 'app.env'; backup = stage / 'backup'; backup.mkdir(mode=0o700)
    key = stage / 'backup-key'; key.write_text(base64.b64encode(secrets.token_bytes(32)).decode()); key.chmod(0o600)
    marker = str(uuid.uuid4())
    if backup_mode == 'remote': (backup / '.athlete-panel-storage-id').write_text(marker)
    policy = stage / 'backup-storage.json'; write_json(policy, {'version': 1, 'id': marker, 'mountFingerprint': '0' * 64, 'testOnly': True})
    values = {'POSTGRES_USER': 'fixture_admin', 'POSTGRES_DB': 'adoption_test', 'POSTGRES_PASSWORD': secrets.token_hex(16),
              'APP_DATABASE_ROLE': 'fixture_app', 'APP_DATABASE_PASSWORD': secrets.token_hex(16), 'ENCRYPTION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
              'ATHLETE_PANEL_DOMAIN': 'localhost:' + str(port), 'BACKUP_KEY_FILE': str(key), 'BACKUP_DESTINATION': str(backup)}
    env_path.write_text(''.join(name + '=' + json.dumps(value) + '\n' for name, value in values.items())); env_path.chmod(0o600)
    prefix = ['docker', '--context', context, 'compose', '-p', project, '-f', str(config_path), '--env-file', str(env_path), '--profile', '*']
    proxy_prefix = None; started = time.monotonic(); evidence = {'ingress': ingress, 'result': 'failed'}
    try:
        rendered = fixture.run(['docker', 'compose', '-p', project, '-f', str(ROOT / 'compose.yml'), '--env-file', str(env_path), '--profile', '*', 'config', '--format', 'json'])
        config = json.loads(rendered.stdout)
        if ingress == 'external':
            reference = config['services']['db']['image']
            if fixture.run(['docker', 'image', 'inspect', reference], check=False).returncode:
                fixture.run(['docker', 'pull', reference])
            database_image = json.loads(fixture.run(['docker', 'image', 'inspect', reference]).stdout)[0]
            config['services']['db']['image'] = next(ref for ref in database_image['RepoDigests'] if ref.startswith('postgres@'))
        selected = json.loads(fixture.run(['docker', 'image', 'inspect', image]).stdout)[0]['Id']
        caddyfile = stage / 'Caddyfile'
        caddyfile.write_text('localhost {\n tls internal\n reverse_proxy dashboard:3000 {\n header_up X-Athlete-Panel-Client-IP {remote_host}\n }\n}\n')
        for name, service in config['services'].items():
            service.pop('build', None)
            if name in {'web', 'worker', 'backup', 'admin', 'recovery'}:
                service.update(image=selected, platform='linux/amd64', pull_policy='never')
                service['environment']['DATABASE_URL'] = service['environment']['DATABASE_URL'].replace('@db:', '@postgres:')
            if service.get('depends_on'): service['depends_on'] = {roles[name]: value for name, value in service['depends_on'].items()}
            service['networks'] = {'private': None}
        for role in ['backup', 'recovery']: config['services'][role]['user'] = f'{os.getuid()}:{os.getgid()}'
        if backup_mode == 'remote':
            config['services']['backup']['environment']['BACKUP_STORAGE_POLICY'] = '/run/secrets/backup_storage'
            config['services']['backup']['volumes'].append({'type': 'bind', 'source': str(policy), 'target': '/run/secrets/backup_storage', 'read_only': True})
        config['services']['caddy']['ports'] = [{'target': 443, 'published': str(port), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        for mount in config['services']['caddy']['volumes']:
            if mount['target'] == '/etc/caddy/Caddyfile': mount['source'] = str(caddyfile)
        config['networks'] = {'private': {'name': project + '-private', 'internal': True}, 'ingress': {'name': project + '-ingress'}}
        config['services']['caddy']['networks']['ingress'] = None
        config['services'] = {roles[name]: service for name, service in config['services'].items()}
        if ingress == 'external':
            proxy = config['services'].pop('gateway'); proxy.pop('depends_on', None)
            proxy_config = {'name': project + '-proxy', 'services': {'gateway': proxy}, 'networks': {'private': {'external': True, 'name': project + '-private'}, 'ingress': {'name': project + '-ingress'}}, 'volumes': copy.deepcopy(config['volumes'])}
            proxy_path = stage / 'external-proxy.json'; write_json(proxy_path, proxy_config)
            proxy_prefix = ['docker', '--context', context, 'compose', '-p', project + '-proxy', '-f', str(proxy_path)]
        write_json(config_path, config)
        override = stage / 'override.json'; write_json(override, {'services': {roles['web']: {'labels': {'fixture': 'synthetic-adoption'}}}})
        prefix += ['-f', str(override)]
        fixture.record = {'project': project, 'database': 'adoption_test', 'domain': 'localhost', 'backupDirectory': str(backup), 'backupMode': backup_mode}
        def compose(release, args, **kwargs):
            args = [roles.get(word, word) for word in args]
            if proxy_prefix and 'gateway' in args: return fixture.run(proxy_prefix + args, **kwargs)
            return fixture.run(prefix + args, **kwargs)
        fixture.compose = compose
        fixture.compose({}, ['up', '-d', '--wait', 'db'])
        fixture.console({}, 'admin', 'scripts/migrate.ts')
        password = 'Synthetic-adoption-' + secrets.token_hex(12)
        fixture.console({}, 'admin', 'scripts/owner.ts', 'bootstrap', '--password-stdin', data=password + '\n')
        fixture.compose({}, ['up', '-d', '--wait', '--no-deps', 'web', 'worker', 'backup'])
        fixture.compose({}, ['up', '-d', '--no-deps', 'caddy'])
        fixture.running_health({'image': selected}, timestamp())
        browser = helpers.Browser(fixture); browser.request('/api/auth/login', {'password': password})
        workout = str(uuid.uuid4())
        browser.request('/api/plugins/training/mutate', {'idempotencyKey': str(uuid.uuid4()), 'commands': [{'action': 'workout.create', 'values': {
            'id': workout, 'title': 'Synthetic adoption ride', 'sport': 'cycling', 'schedule': {'kind': 'independent', 'date': '2026-10-30'}, 'durationSeconds': 3600}}]})
        def persisted():
            workspace = browser.request('/api/workspace?from=2026-10-26&to=2026-11-01')['state']
            return next(item for item in workspace['workouts'] if item['id'] == workout)
        before_record = persisted()
        inputs = {'project': project, 'directory': str(stage), 'context': context, 'ingress': ingress,
                  'files': [str(config_path), str(override)], 'envFiles': [str(env_path)], 'roles': {key: value for key, value in roles.items() if key != 'caddy' or ingress == 'caddy'}}
        if ingress == 'external': test['caFile'] = str(fixture.state / 'test-ca.crt')
        state = stage / 'operator'; files = {path: path.read_bytes() for path in [config_path, override, env_path, key, caddyfile, policy]}
        first, preview = inspect_adoption(inputs, test=test)
        second, _ = inspect_adoption(inputs, test=test)
        if first != second: raise AssertionError('Nondeterministic preview fields: ' + ', '.join(changed_fields(first, second)))
        assert not state.exists()
        adopt(state, inputs, preview['confirmation'], test=test, lock_root=stage)
        instance = Hosted(state, test=test); instance.lock_root = stage
        shutil.copyfile(fixture.state / 'test-ca.crt', state / 'test-ca.crt')
        base = copy.deepcopy(instance.record['active']); original_runtime = copy.deepcopy(instance.record['profile']['runtime'])
        repeated = adopt(state, inputs, preview['confirmation'], test=test, lock_root=stage)
        assert repeated['unchanged'] and all(path.read_bytes() == content for path, content in files.items())
        assert before_record == persisted()
        # Preparation fails before maintenance when configuration drift is present.
        override.write_text(override.read_text() + '\n')
        try: instance.upgrade(local_image=candidate)
        except OperationError as error: assert 'reconcile' in str(error)
        else: raise AssertionError('Drift was silently accepted')
        review = reconcile(instance); reconcile(instance, review['confirmation'])
        # Simulate interruption after SQL commit: the same migration command must
        # be safe on resume, with mandatory rehearsal and two distinct snapshots.
        real_step = instance.step
        def interrupted(name, action):
            if name == 'apply-migrations':
                def fail(): action(); raise RuntimeError('Synthetic interruption after commit')
                return real_step(name, fail)
            return real_step(name, action)
        instance.step = interrupted
        with instance.lock():
            try: instance.upgrade(local_image=candidate)
            except RuntimeError: pass
            else: raise AssertionError('Expected interrupted first upgrade')
        assert instance.pending['backup']['file'] != instance.pending['preparationBackup']['file']
        recovery_point = backup / instance.pending['backup']['file']
        instance = Hosted(state, test=test); instance.lock_root = stage
        real_step = instance.step
        def missing_backup(name, action):
            if name == 'start-scheduled-backups':
                instance.compose(instance.pending['candidate'], ['--profile', 'backup', 'rm', '-s', '-f', 'backup'])
                raise RuntimeError('Synthetic missing backup after reopening')
            return real_step(name, action)
        instance.step = missing_backup
        with instance.lock():
            try: instance.resume()
            except RuntimeError: pass
            else: raise AssertionError('Expected missing-backup interruption')
        assert 'reopen-application' in instance.pending['completed']
        serving_ids = instance.compose(instance.pending['candidate'], ['ps', '-q', 'web', 'worker']).stdout
        instance = Hosted(state, test=test); instance.lock_root = stage
        with instance.lock(): instance.resume()
        assert instance.backup_mode() == backup_mode
        assert instance.backup_status(instance.record['active'])['lastBackup']['storage'] == ('local' if backup_mode == 'local' else 'isolated-test')
        with instance.lock(): instance.restore_test()
        assert instance.compose(instance.record['active'], ['ps', '-q', 'web', 'worker']).stdout == serving_ids
        browser = helpers.Browser(instance); browser.request('/api/auth/login', {'password': password})
        assert persisted() == before_record
        assert instance.compose(instance.record['active'], ['exec', '-T', 'db', 'psql', '-U', 'fixture_admin', '-d', 'adoption_test', '-Atc', 'select count(*) from athlete.adoption_rehearsal']).stdout.strip() == '1'
        for name in [roles['db']] + ([roles['caddy']] if ingress == 'caddy' else []):
            assert instance.record['profile']['runtime'][name]['id'] == original_runtime[name]['id']
        instance.compose(instance.record['active'], ['rm', '-s', '-f', 'web'])
        with instance.lock(): instance.recover(recovery_point)
        browser = helpers.Browser(instance); browser.request('/api/auth/login', {'password': password})
        assert persisted() == before_record
        assert instance.record['active']['metadata'] == base['metadata']
        assert instance.record['active']['database'] != 'adoption_test'
        assert fixture.compose({}, ['exec', '-T', 'db', 'psql', '-U', 'fixture_admin', '-d', 'postgres', '-Atc', "select 1 from pg_database where datname='adoption_test'"]).stdout.strip() == '1'
        assert all(path.read_bytes() == content for path, content in files.items() if path != override)
        evidence.update(result='succeeded', preservedRecord=fingerprint(before_record), containerIdsUnchangedAtAdoption=True,
                        missingBackupResumed=True, missingWebRecovered=True, backupMode=backup_mode, restoreTest=True, postgresReference=config['services'][roles['db']]['image'],
                        cluster=instance.record['profile']['cluster'], restoredInitialRelease=True,
                        operations=[json.loads(path.read_text())['seconds'] for path in state.glob('completed-*.json')])
    finally:
        evidence['seconds'] = round(time.monotonic() - started, 3); reports.append(evidence)
        if proxy_prefix: fixture.run(proxy_prefix + ['down', '-v', '--remove-orphans'], check=False)
        if config_path.exists(): fixture.run(prefix + ['down', '-v', '--remove-orphans'], check=False)
        shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--image', required=True)
    parser.add_argument('--ingress', choices=['caddy', 'external', 'both'], default='both'); parser.add_argument('--report', type=Path)
    args = parser.parse_args(); reports = []
    # Build a real source candidate so generated registries and compiled app code
    # see the new immutable migration, just as a release build does.
    candidate = 'athlete-panel-adoption-candidate:' + secrets.token_hex(8)
    with tempfile.TemporaryDirectory(prefix='athlete-panel-adoption-candidate-') as folder:
        directory = Path(folder) / 'source'; helpers.copy_candidate(directory)
        manifest_path = directory / 'plugins/athlete/manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['migrations'].append('migrations/991-adoption-rehearsal.sql')
        manifest_path.write_text(json.dumps(manifest))
        (directory / 'plugins/athlete/migrations/991-adoption-rehearsal.sql').write_text('create table athlete.adoption_rehearsal(id integer primary key); insert into athlete.adoption_rehearsal values(1);\n')
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-t', candidate, str(directory)], check=True)
    try:
        for ingress in (['caddy', 'external'] if args.ingress == 'both' else [args.ingress]): scenario(args.image, candidate, ingress, reports)
    finally:
        subprocess.run(['docker', 'image', 'rm', candidate], check=False, stdout=subprocess.DEVNULL)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True); args.report.write_text(json.dumps(reports, indent=2) + '\n')


if __name__ == '__main__': main()
