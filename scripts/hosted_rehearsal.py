"""Disposable real-backup rehearsal shared by upgrade and restore-test.

Only this module's generated, labelled resources may be removed. No live Compose
configuration is reused: candidate controls must never mount owner volumes here.
"""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import time
import uuid


def cleanup(instance, identity):
    from hosted import OperationError
    if not re.fullmatch('[a-f0-9]{32}', identity):
        raise OperationError('Invalid rehearsal resource identity; nothing was removed.')
    selector = 'label=io.athlete-panel.rehearsal=' + identity
    for kind, listing, removal in [
        ('container', ['ps', '-aq'], ['rm', '-f']),
        ('volume', ['volume', 'ls', '-q'], ['volume', 'rm']),
        ('network', ['network', 'ls', '-q'], ['network', 'rm']),
    ]:
        resources = instance.run(['docker', *listing, '--filter', selector]).stdout.split()
        for resource in resources:
            labels = json.loads(instance.run(['docker', kind, 'inspect', resource]).stdout)[0]
            labels = labels.get('Config', {}).get('Labels', {}) if kind == 'container' else labels.get('Labels', {})
            if labels.get('io.athlete-panel.rehearsal') != identity:
                raise OperationError('Rehearsal cleanup label mismatch; unrelated resources were retained.')
            instance.run(['docker', *removal, resource])
    directory = instance.state / ('rehearsal-' + identity)
    if directory.is_symlink(): raise OperationError('Unsafe rehearsal directory; it was retained.')
    if directory.exists(): shutil.rmtree(directory)


def rehearse(instance, archive, candidate=None):
    from hosted import DATA_CHECK, OperationError, parse_configuration, private_directory, timestamp, write_json
    previous_attempt = instance.pending.get('rehearsal')
    if previous_attempt:
        cleanup(instance, previous_attempt['id'])
    identity = uuid.uuid4().hex
    evidence = {'id': identity, 'startedAt': timestamp(), 'state': 'running', 'phases': []}
    instance.pending['rehearsal'] = evidence; instance.checkpoint()
    directory = private_directory(instance.state / ('rehearsal-' + identity))
    started = time.monotonic()

    def phase(name, action):
        print('Rehearsal: ' + name + '…', flush=True)
        clock = time.monotonic()
        result = action()
        evidence['phases'].append({'name': name, 'seconds': round(time.monotonic() - clock, 3)})
        instance.checkpoint()
        return result

    try:
        tools = candidate or instance.pending['previous']
        values = instance.configuration()
        admin_password, app_password = secrets.token_hex(32), secrets.token_hex(32)
        database = 'athlete_panel_rehearsal_test'
        labels = {'io.athlete-panel.rehearsal': identity}
        target = private_directory(directory / 'restored')
        key = instance.backup_key()
        def bind(source, destination, readonly=True):
            return {'type': 'bind', 'source': str(source), 'target': destination,
                    'read_only': readonly, 'bind': {'create_host_path': False}}
        environment = {'DATABASE_URL': f'postgresql://rehearsal_admin:{admin_password}@db:5432/{database}',
                       'APP_DATABASE_ROLE': 'rehearsal_app', 'APP_DATABASE_PASSWORD': app_password,
                       'ENCRYPTION_KEY': values['ENCRYPTION_KEY'], 'BACKUP_KEY_FILE': '/run/secrets/backup_key',
                       'APP_ORIGIN': 'https://rehearsal.invalid', 'COOKIE_SECURE': 'true'}
        config = {
            'name': 'athlete-panel-rehearsal-' + identity,
            'services': {
                'db': {'image': 'postgres:17-bookworm', 'labels': labels,
                       'environment': {'POSTGRES_USER': 'rehearsal_admin', 'POSTGRES_PASSWORD': admin_password, 'POSTGRES_DB': database},
                       'volumes': ['data:/var/lib/postgresql/data'],
                       'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U rehearsal_admin'], 'interval': '2s', 'timeout': '5s', 'retries': 30}},
                'restore': {'image': tools['image'], 'pull_policy': 'never', 'labels': labels,
                            'user': f'{os.getuid()}:{os.getgid()}', 'environment': environment,
                            'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
                            'volumes': [bind(archive, '/selected.fgr'), bind(key, '/run/secrets/backup_key'), bind(target, '/restore', False)]},
            },
            'networks': {'default': {'internal': True, 'labels': labels}},
            'volumes': {'data': {'labels': labels}},
        }
        compose_file = directory / 'compose.json'
        write_json(compose_file, config)
        def compose(*args, **kwargs):
            return instance.run(['docker', 'compose', '-p', config['name'], '-f', str(compose_file), *args], **kwargs)
        # Download infrastructure before the isolated network exists; no image pulls in the guest.
        if instance.run(['docker', 'image', 'inspect', 'postgres:17-bookworm'], check=False).returncode:
            instance.run(['docker', 'pull', 'postgres:17-bookworm'])
        phase('start isolated database', lambda: compose('up', '-d', '--wait', 'db'))
        # The existing restore API authenticates before modifying even this disposable target.
        # Return only identity, so matching-image selection needs no separate archive read.
        restore_script = """import {restoreBackup} from './scripts/restore.ts';
const metadata=await restoreBackup({file:'/selected.fgr',sourceDirectory:'/restore/matched-source',confirmReplace:true,
databaseUrl:process.env.DATABASE_URL,keyFile:process.env.BACKUP_KEY_FILE,encryptionKey:process.env.ENCRYPTION_KEY});
console.log(JSON.stringify({release:metadata.release??null,verified:true}));"""
        metadata = json.loads(phase('authenticate and restore snapshot', lambda: compose('run', '--rm', '--no-deps', '-T', 'restore',
             'node', '--import', 'tsx', '--input-type=module', '-e', restore_script)).stdout)
        if candidate is None:
            source = target / 'matched-source'
            for root, _, files in os.walk(source):
                Path(root).chmod(0o755)
                for filename in files:
                    path = Path(root) / filename
                    if path.is_symlink(): raise OperationError('Unsafe restored source.')
                    path.chmod(0o644)
            instance.pending['archiveMetadata'] = metadata; instance.checkpoint()
            phase('select matching image', lambda: instance.recovered_image(source))
            candidate = instance.pending['candidate']
        evidence['image'] = candidate['image']
        evidence['commit'] = candidate.get('metadata', {}).get('commit')
        base = {'image': candidate['image'], 'pull_policy': 'never', 'labels': labels,
                'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true']}
        runtime_env = {key: value for key, value in environment.items() if key not in {'APP_DATABASE_PASSWORD', 'APP_DATABASE_ROLE', 'BACKUP_KEY_FILE'}}
        runtime_env['DATABASE_URL'] = f'postgresql://rehearsal_app:{app_password}@db:5432/{database}'
        config['services'].update({
            'admin': {**base, 'environment': environment},
            'web': {**base, 'environment': runtime_env},
            'worker': {**base, 'environment': runtime_env, 'command': ['node', 'dist/worker/index.js']},
        })
        write_json(compose_file, config)
        phase('migrate and refresh permissions', lambda: compose('run', '--rm', '--no-deps', '-T', 'admin', 'node', '--import', 'tsx', 'scripts/migrate.ts'))
        phase('verify schema', lambda: compose('run', '--rm', '--no-deps', '-T', 'web', 'node', '--import', 'tsx', 'scripts/operations.ts', 'verify-schema'))
        phase('verify saved data', lambda: compose('run', '--rm', '--no-deps', '-T', 'web', 'node', '--import', 'tsx', '--input-type=module', '-e', DATA_CHECK))
        phase('start isolated application', lambda: compose('up', '-d', '--no-deps', 'web', 'worker'))
        def ready():
            for _ in range(60):
                health = compose('exec', '-T', 'web', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))", check=False)
                worker = compose('run', '--rm', '--no-deps', '-T', 'web', 'node', '--import', 'tsx', 'scripts/operations.ts', 'worker-health', check=False)
                if health.returncode == 0 and worker.returncode == 0: return
                time.sleep(2)
            raise OperationError('Isolated application or worker readiness failed. Live services were not changed.')
        phase('verify application and worker', ready)
        # Restoring sets maintenance and clears old heartbeats. Assert no live jobs were claimed.
        guard = "select (select value='true'::jsonb from host.settings where key='maintenance') and (select value->>'state'='maintenance' from host.settings where key='worker') and not exists(select 1 from host.jobs where status='running')"
        if compose('exec', '-T', 'db', 'psql', '-U', 'rehearsal_admin', '-d', database, '-Atc', guard).stdout.strip() != 't':
            raise OperationError('Rehearsal maintenance isolation failed.')
        evidence['state'] = 'succeeded'
    except BaseException:
        evidence['state'] = 'failed'
        raise
    finally:
        evidence.update(finishedAt=timestamp(), seconds=round(time.monotonic() - started, 3))
        evidence['cleanup'] = 'pending'; instance.checkpoint()
        cleanup(instance, identity)
        evidence['cleanup'] = 'complete'; instance.checkpoint()
        write_json(instance.state / ('rehearsal-result-' + identity + '.json'), evidence)
    return evidence
