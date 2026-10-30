"""Bounded, administrative adoption of a local Docker Compose project.

Inspection never invokes compose up/run, shell wrappers, migrations or backups.
The saved effective model is private and keeps the operator's service topology.
"""
from contextlib import contextmanager
import copy
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit, unquote

import image_identity

ROLES = ('web', 'worker', 'db', 'admin', 'recovery', 'backup')
APPLICATION = ('web', 'worker', 'admin', 'recovery', 'backup')


def fail(message):
    from hosted import OperationError
    raise OperationError(message)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def changed_fields(before, after, prefix=''):
    if isinstance(before, dict) and isinstance(after, dict):
        return [field for key in sorted(set(before) | set(after)) for field in changed_fields(before.get(key), after.get(key), prefix + '.' + key)]
    return [prefix] if before != after else []


def run(args, **kwargs):
    env = {key: value for key, value in os.environ.items() if key in {'PATH', 'HOME', 'DOCKER_CONFIG', 'SSH_AUTH_SOCK'}}
    result = subprocess.run([str(arg) for arg in args], env=env, text=True, capture_output=True, timeout=120, **kwargs)
    if result.returncode: fail('Adoption inspection failed. Check Docker access, Compose inputs and required files. Private command output was withheld.')
    return result


def docker(context, *args):
    return ['docker', '--context', context, *args]


def project_command(inputs):
    command = docker(inputs['context'], 'compose', '--project-directory', inputs['directory'], '-p', inputs['project'])
    for path in inputs['files']: command += ['-f', path]
    # An explicit empty list is prohibited: implicit checkout .env loading is ambiguous.
    for path in inputs['envFiles']: command += ['--env-file', path]
    return command + ['--profile', '*']


def endpoint(context, execute=run, test=False):
    info = json.loads(execute(docker(context, 'context', 'inspect', context)).stdout)[0]
    host = info['Endpoints']['docker']['Host']
    if not host.startswith('unix://'):
        fail('Adoption supports a local Unix Docker endpoint only. Run the controller on the Docker host; remote/SSH/TCP contexts are unsupported.')
    server = json.loads(execute(docker(context, 'info', '--format', '{{json .}}')).stdout)
    if server.get('OSType') != 'linux' or (not test and os.uname().sysname != 'Linux'):
        fail('Hosted adoption requires a Linux host and Linux Docker engine. macOS is supported only by the isolated test harness.')
    return {'id': server['ID'], 'host': host, 'architecture': server['Architecture']}


@contextmanager
def project_lock(daemon, project, state, *, claim=False, root=None):
    """One ownership record for every local daemon/project, independent of --state.

    A shared host directory also refuses other Unix users, rather than allowing
    them to establish a second controller. Docker/root administrators can of
    course deliberately remove these records; they are not a security sandbox.
    """
    from hosted import private_directory, read_json, write_json
    key = fingerprint({'daemon': daemon, 'project': project})
    directory = private_directory(Path(root or '/var/tmp') / ('athlete-panel-controller-' + key))
    fd = os.open(directory / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: fail('Another controller is operating on this Docker project. Wait for it to finish.')
        owner = read_json(directory / 'owner.json')
        expected = {'version': 1, 'state': str(Path(state).resolve()), 'daemon': daemon, 'project': project}
        if owner and owner != expected:
            fail('This Docker project already belongs to another controller state directory. Use its original --state; do not adopt it again.')
        if claim and not owner: write_json(directory / 'owner.json', expected)
        if not claim and not owner: fail('The project ownership record is missing. Restore it from the recovery kit before operating this adopted installation.')
        yield directory
    finally: os.close(fd)


def file_fact(path, private=False):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        fail('A referenced file is missing, relative or a symlink. Supply existing absolute regular-file paths.')
    stat = path.stat()
    if private and (stat.st_uid != os.getuid() or stat.st_mode & 0o077):
        fail('Environment and secret files must belong to the controller account and have mode 0600.')
    return {'sha256': image_identity.file_checksum(path), 'mode': stat.st_mode & 0o777, 'uid': stat.st_uid}


def host_file(config, service, target):
    for volume in service.get('volumes', []):
        if volume.get('target') == target and volume.get('type') == 'bind':
            return volume['source']
    for secret in service.get('secrets', []):
        name = secret['source']; destination = secret.get('target', name)
        if not destination.startswith('/'): destination = '/run/secrets/' + destination
        if destination == target:
            source = config.get('secrets', {}).get(name, {})
            if source.get('external') or not source.get('file'): fail('Only existing file-backed Compose secrets are supported.')
            return source['file']
    fail('A required backup key/storage policy is not backed by an existing host file. Add a file-backed secret or read-only bind explicitly before adoption.')


def validate_runtime_mounts(config, service, container):
    expected = {}
    for mount in service.get('volumes', []):
        source = mount['source']
        if mount['type'] == 'volume': source = config['volumes'][source]['name']
        expected[mount['target']] = (mount['type'], source, not mount.get('read_only', False))
    for kind in ['secrets', 'configs']:
        for mount in service.get(kind, []):
            source = config[kind][mount['source']]['file']
            target = mount.get('target', mount['source'])
            if not target.startswith('/'): target = ('/run/secrets/' if kind == 'secrets' else '/') + target
            if target in expected: fail('Overlapping secret/config/volume targets are unsupported.')
            expected[target] = ('bind', source, False)
    actual = {mount['Destination']: (mount['Type'], mount.get('Name') if mount['Type'] == 'volume' else mount['Source'], mount['RW']) for mount in container['Mounts']}
    if actual != expected: fail('Running storage mounts disagree with Compose inputs. Reconcile the actual sources and read-only flags before adoption.')
    networks = {config['networks'][name]['name'] for name in service.get('networks', {})}
    if set(container['NetworkSettings']['Networks']) != networks:
        fail('Running network membership disagrees with Compose inputs. Declare every existing network explicitly before adoption.')


def database_url(value, db_service):
    parsed = urlsplit(value or '')
    if (parsed.scheme not in {'postgres', 'postgresql'} or parsed.hostname != db_service or parsed.port not in {None, 5432}
            or parsed.query or parsed.fragment or not parsed.username or not parsed.password
            or not re.fullmatch('/[a-z][a-z0-9_]*', parsed.path)):
        fail('Use one in-project PostgreSQL service on port 5432 and explicit database URLs. External databases, URL options and nonstandard database names are unsupported.')
    return parsed


def inspect(inputs, execute=run, test=False, managed=None):
    """Return private evidence and a separately sanitized public preview."""
    from hosted import valid_metadata, read_json, mount_identity, REMOTE_FILESYSTEMS, registry_repository
    if not re.fullmatch('[a-z0-9][a-z0-9_-]*', inputs['project']): fail('Invalid Compose project name.')
    if re.fullmatch(r'athlete-panel-hosted-[a-f0-9]{10}', inputs['project']):
        fail('This project name is reserved for controller-created installations. Recover its original managed state; do not adopt it into a second controller.')
    if not inputs['files'] or not inputs['envFiles']: fail('Supply ordered --compose-file and --env-file paths explicitly (an empty private env file is allowed).')
    directory = Path(inputs['directory'])
    if not directory.is_absolute() or not directory.is_dir() or directory.is_symlink(): fail('Use an existing absolute project directory without symlinks.')
    facts = {path: file_fact(path, path in inputs['envFiles']) for path in inputs['files'] + inputs['envFiles']}
    for path in inputs['files']:
        # Include/extends graphs have additional file ownership and reconciliation
        # semantics. Require an explicit ordered -f list in this first matrix.
        if re.search(r'''(?:^|[,{])\s*["']?(?:include|extends)["']?\s*:''', Path(path).read_text(), re.MULTILINE):
            fail('Compose include/extends indirection is unsupported. Supply a reviewed flattened model or explicit ordered override files.')
    daemon = endpoint(inputs['context'], execute, test)
    command = project_command(inputs)
    config = json.loads(execute(command + ['config', '--format', 'json']).stdout)
    unresolved = json.loads(execute(command + ['config', '--format', 'json', '--no-env-resolution']).stdout)
    mappings = {role: inputs.get('roles', {}).get(role, role) for role in ROLES}
    if inputs['ingress'] == 'caddy': mappings['caddy'] = inputs.get('roles', {}).get('caddy', 'caddy')
    if len(set(mappings.values())) != len(mappings): fail('Each service role must map to a different service.')
    if set(config['services']) != set(mappings.values()):
        fail('The Compose model must contain exactly the mapped application, database and optional Caddy services. Separate unrelated services or provide all --service role=name mappings.')
    for service in unresolved['services'].values():
        for entry in service.get('env_file', []):
            path = entry if isinstance(entry, str) else entry['path']
            facts[path] = file_fact(path, True)
    for kind in ['configs', 'secrets']:
        for source in config.get(kind, {}).values():
            if source.get('external') or not source.get('file'): fail('External/config-environment secrets are unsupported; use explicit private files.')
            facts[source['file']] = file_fact(source['file'], kind == 'secrets')
    services = {role: config['services'][name] for role, name in mappings.items()}
    for role, service in services.items():
        if any(service.get(key) for key in ['privileged', 'devices', 'network_mode', 'pid', 'ipc', 'volumes_from', 'develop', 'deploy', 'scale']):
            fail('Unsupported host namespaces, privileges, replicas or lifecycle customization in role ' + role + '.')
        if service.get('entrypoint'): fail('Custom entrypoints are unsupported. Bake trusted plugins into a protocol-1 image.')
        if role in APPLICATION:
            if service.get('configs'): fail('Application Compose configs mounts are unsupported. Use environment or file-backed /run/secrets inputs; source must remain in the image.')
            for volume in service.get('volumes', []):
                target = volume['target']
                backup_target = service.get('environment', {}).get('BACKUP_DESTINATION', '/backups')
                if not target.startswith('/run/secrets/') and not (role in {'backup', 'recovery'} and target == backup_target):
                    fail('Application/source mounts are unsupported. Include custom plugins and migrations in the image; only backup storage and /run/secrets mounts are supported.')
        for volume in service.get('volumes', []):
            if volume['type'] not in {'bind', 'volume'}: fail('Only named volumes and bind mounts are supported.')
            if volume['type'] == 'bind':
                path = Path(volume['source'])
                if path.is_symlink() or not path.exists(): fail('A bind mount is missing or a symlink. Restore it before adoption.')
                if path.is_file(): facts[str(path)] = file_fact(path, role in APPLICATION)
    db = services['db']
    if not re.fullmatch(r'(?:docker.io/library/)?postgres:17(?:[-.@].*)?', db.get('image', '')) or db.get('ports'):
        fail('Only a private in-project PostgreSQL 17 service is supported. Major upgrades/exposed database ports require a separate reviewed procedure.')
    mounts = [item for item in db.get('volumes', []) if item['target'] == '/var/lib/postgresql/data']
    if len(mounts) != 1 or len(db.get('volumes', [])) != 1 or db.get('command'):
        fail('PostgreSQL requires one existing data mount at /var/lib/postgresql/data and its standard command.')
    expected_commands = {'worker': ['node', 'dist/worker/index.js'], 'backup': ['pnpm', 'exec', 'tsx', 'scripts/operations.ts', 'backup-loop']}
    for role, expected in expected_commands.items():
        if services[role].get('command') != expected:
            fail('Unsupported ' + role + ' command. Use the documented worker and sole backup-loop scheduler before adoption.')
    if services['web'].get('command'): fail('Use the image default web command; custom launch wrappers are unsupported.')
    environment = services['web'].get('environment', {})
    origin = urlsplit(environment.get('APP_ORIGIN', ''))
    if origin.scheme != 'https' or not origin.hostname or origin.path not in {'', '/'} or origin.query or origin.fragment or origin.username:
        fail('Adoption requires the existing public HTTPS origin without a URL path.')
    if environment.get('COOKIE_SECURE') != 'true' or environment.get('TRUST_PROXY_CLIENT_IP') != 'true':
        fail('Hosted adoption requires secure cookies and the documented trusted-proxy header configuration.')
    runtime = database_url(environment.get('DATABASE_URL'), mappings['db'])
    admin = database_url(services['admin'].get('environment', {}).get('DATABASE_URL'), mappings['db'])
    if runtime.path != admin.path or runtime.username == admin.username:
        fail('Administration and runtime must use separate users in the same database.')
    db_env = db.get('environment', {})
    if db_env.get('POSTGRES_USER', 'postgres') != unquote(admin.username) or db_env.get('POSTGRES_PASSWORD') != unquote(admin.password):
        fail('Database environment and administrative URL disagree. Reconcile credentials before adoption.')
    encryption = environment.get('ENCRYPTION_KEY')
    try:
        decoded = base64.b64decode(encryption or '', validate=True)
        if len(decoded) != 32 or base64.b64encode(decoded).decode() != encryption: raise ValueError()
    except ValueError: fail('An existing canonical base64 application encryption key (32 bytes) in resolved environment is required.')
    for role in APPLICATION:
        env = services[role].get('environment', {})
        expected = admin if role in {'admin', 'recovery'} else runtime
        if database_url(env.get('DATABASE_URL'), mappings['db']) != expected or env.get('ENCRYPTION_KEY') != encryption or env.get('APP_ORIGIN') != environment['APP_ORIGIN']:
            fail('Application service credentials, origin or encryption keys disagree. Reconcile the selected Compose files before adoption.')
    admin_env = services['admin']['environment']
    if admin_env.get('APP_DATABASE_ROLE') != unquote(runtime.username) or admin_env.get('APP_DATABASE_PASSWORD') != unquote(runtime.password):
        fail('Permission-refresh configuration does not match the runtime database user.')
    for role in ['backup', 'recovery']:
        user = str(services[role].get('user', '')).split(':', 1)[0]
        if user != str(os.getuid()):
            fail('Backup and recovery services must explicitly use the controller account UID so private keys, archives and rehearsal files remain readable. Reconcile this prerequisite manually; adoption does not change service users.')
    backup = services['backup']; backup_env = backup['environment']
    destination = backup_env.get('BACKUP_DESTINATION', '/backups')
    storage = [volume for volume in backup.get('volumes', []) if volume['target'] == destination and volume['type'] == 'bind' and not volume.get('read_only')]
    if len(storage) != 1: fail('Backups require an existing writable off-host bind mount, not an unverified named/local volume.')
    storage = storage[0]['source']
    key = host_file(config, backup, backup_env.get('BACKUP_KEY_FILE'))
    if host_file(config, services['recovery'], services['recovery']['environment'].get('BACKUP_KEY_FILE')) != key:
        fail('Backup and recovery must reference the same separately recoverable backup key.')
    policy_path = host_file(config, backup, backup_env.get('BACKUP_STORAGE_POLICY'))
    policy = read_json(policy_path)
    if not policy or policy.get('version') != 1 or bool(policy.get('testOnly')) != bool(test):
        fail('Existing backup storage must have a registered remote-storage policy. Complete the documented storage setup separately; adoption never weakens or silently registers protection.')
    facts[key] = file_fact(key, True); facts[policy_path] = file_fact(policy_path, True)
    try:
        encoded_key = Path(key).read_text().strip()
        decoded_key = base64.b64decode(encoded_key, validate=True)
        if len(decoded_key) != 32 or base64.b64encode(decoded_key).decode() != encoded_key: raise ValueError()
    except ValueError: fail('The backup key file is not a canonical base64 32-byte key. Recover the original protected key; adoption never generates a replacement.')
    marker = Path(storage) / '.athlete-panel-storage-id'
    if marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != policy['id']:
        fail('The backup storage identity marker is missing or changed.')
    if not test:
        filesystem, mount = mount_identity(storage)
        if filesystem not in REMOTE_FILESYSTEMS or mount != policy['mountFingerprint']:
            fail('The registered off-host backup mount is unavailable. Restore it before adoption.')
    # Inspect the selected project only. Never infer a project from a checkout name.
    ids = execute(docker(inputs['context'], 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + inputs['project'], '--filter', 'label=com.docker.compose.oneoff=False')).stdout.split()
    if not ids: fail('The selected Compose project has no existing containers; adoption never creates an instance.')
    containers = json.loads(execute(docker(inputs['context'], 'inspect', *ids)).stdout)
    actual = {}
    hashes = dict(line.split(' ', 1) for line in execute(command + ['config', '--hash', '*']).stdout.splitlines() if ' ' in line)
    for container in containers:
        labels = container['Config'].get('Labels', {}); name = labels.get('com.docker.compose.service')
        if name not in mappings.values() or name in actual: fail('Unmapped services or replicas exist in the project. Resolve them explicitly before adoption.')
        if not container['State']['Running']: fail('All long-running mapped services must be running before adoption.')
        if not managed and labels.get('com.docker.compose.config-hash') != hashes.get(name):
            fail('Running service configuration differs from the selected Compose model (or its Compose version). Reconcile the manual installation with these inputs, then preview again.')
        actual[name] = container
    required = {'web', 'worker', 'db', 'backup'} | ({'caddy'} if inputs['ingress'] == 'caddy' else set())
    if set(actual) != {mappings[role] for role in required}: fail('Expected one running container per web/worker/database/backup/optional-Caddy role and no running admin/recovery service.')
    web = actual[mappings['web']]
    image = web['Image']
    if managed and not managed.image_matches(image, managed.record['active']): fail('Reconciliation cannot select a different running release. Use explicit recovery or restore the controller-selected image.')
    if any(actual[mappings[role]]['Image'] != image for role in ['worker', 'backup']): fail('Web, worker and backup must run the same release before adoption.')
    execute_docker = lambda args: execute(docker(inputs['context'], *args[1:]))
    image_info = json.loads(execute_docker(['docker', 'image', 'inspect', image]).stdout)[0]
    for role in APPLICATION:
        selected = json.loads(execute_docker(['docker', 'image', 'inspect', services[role]['image']]).stdout)[0]
        if not managed and selected['Id'] != image: fail('A selected application tag has moved or services select different images. Pin the current release in the manual configuration first.')
    for role in required:
        container = actual[mappings[role]]; service = services[role]
        validate_runtime_mounts(config, service, container)
        env = dict(value.split('=', 1) for value in container['Config'].get('Env', []) if '=' in value)
        expected_env = dict(service.get('environment', {}))
        if managed and role in APPLICATION:
            old = urlsplit(expected_env['DATABASE_URL'])
            expected_env['DATABASE_URL'] = urlunsplit(old._replace(path='/' + managed.record['active']['database']))
        if any(env.get(key) != value for key, value in expected_env.items() if key not in {'ATHLETE_PANEL_RELEASE_IDENTITY', 'ATHLETE_PANEL_BACKUP_RUN'}):
            fail('Resolved configuration disagrees with running service environment. Apply reviewed manual changes first, then preview reconciliation.')
    metadata = valid_metadata(json.loads(execute(docker(inputs['context'], 'exec', web['Id'], 'cat', '/app/.athlete-panel-release.json')).stdout))
    architecture = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(daemon['architecture'], daemon['architecture'])
    if not test and image_info.get('Architecture') != architecture: fail('The running image architecture differs from the host. Select a supported native image before adoption.')
    refs = image_info.get('RepoDigests', [])
    requested = services['web']['image']; host = requested.split('/', 1)[0]
    registry = '/' in requested and ('.' in host or ':' in host or host == 'localhost')
    matching = [ref for ref in refs if registry_repository(ref) == registry_repository(requested)] if registry else []
    if registry and not matching: fail('The selected registry image has no matching pinned digest. Pin or load the intended release before adoption.')
    reference = matching[0] if matching else None
    identity = image_identity.identify(image, execute_docker, reference)
    volumes, networks = {}, {}
    for name, volume in config.get('volumes', {}).items():
        info = json.loads(execute(docker(inputs['context'], 'volume', 'inspect', volume['name'])).stdout)[0]
        volumes[name] = {'name': info['Name'], 'driver': info['Driver'], 'mountpoint': info['Mountpoint'], 'created': info.get('CreatedAt'), 'options': info.get('Options')}
    for name, network in config.get('networks', {}).items():
        info = json.loads(execute(docker(inputs['context'], 'network', 'inspect', network['name'])).stdout)[0]
        networks[name] = {'name': info['Name'], 'id': info['Id'], 'internal': info['Internal']}
    # A physical-cluster identifier makes a replaced/reinitialized mount detectable.
    cluster = execute(docker(inputs['context'], 'exec', actual[mappings['db']]['Id'], 'psql', '-U', unquote(admin.username), '-d', admin.path[1:], '-Atc', 'select system_identifier from pg_control_system()')).stdout.strip()
    if not cluster.isdigit(): fail('Could not verify the existing PostgreSQL cluster identity.')
    runtime_fact = {name: {'id': item['Id'], 'image': item['Image'], 'mounts': sorted(item['Mounts'], key=lambda mount: mount['Destination']),
                          'networks': sorted(item['NetworkSettings']['Networks'])} for name, item in actual.items()}
    profile = {'version': 1, 'inputs': inputs, 'daemon': daemon, 'roles': mappings, 'config': config, 'files': facts,
               'runtime': runtime_fact, 'volumes': volumes, 'networks': networks, 'cluster': cluster,
               'backupKey': key, 'storagePolicy': policy_path, 'backupDirectory': storage,
               'origin': environment['APP_ORIGIN'].rstrip('/'), 'database': runtime.path[1:], 'initialDatabase': db_env.get('POSTGRES_DB', admin.path[1:]),
               'release': {'image': image, 'identity': identity, 'registryRef': reference, 'metadata': metadata,
                           'origin': {'kind': 'registry' if reference else 'local', 'requested': reference or image}, 'database': runtime.path[1:]}}
    token = fingerprint(profile)
    preview = {'version': 1, 'project': inputs['project'], 'context': inputs['context'], 'services': mappings,
               'ingress': inputs['ingress'], 'origin': profile['origin'], 'release': {'version': metadata['version'], 'commit': metadata.get('commit'), 'identity': identity},
               'database': profile['database'], 'managed': list(APPLICATION), 'preserved': ['database', 'storage', 'networks', 'ingress', 'configuration', 'keys'],
               'filesTracked': len(facts), 'confirmation': token,
               'next': 'Repeat the same command with --confirm ' + token + '. Only private controller state will be written.'}
    return profile, preview


def adopt(state, inputs, confirmation=None, execute=run, test=False, lock_root=None):
    from hosted import Hosted, ROOT, private_directory, write_json, read_json
    state = Path(state).absolute()
    if state.resolve().is_relative_to(ROOT.resolve()): fail('Keep the adoption state outside the source repository.')
    existing = read_json(state / 'installation.json')
    if existing:
        if (existing.get('version') == 2 and existing.get('profile', {}).get('inputs') == inputs
                and bool(existing.get('testOnly')) == bool(test)):
            if confirmation and confirmation != existing.get('adoptionFingerprint'):
                fail('This project is already adopted. Use status or reconcile; adoption never overwrites an existing profile.')
            return {'project': inputs['project'], 'adopted': True, 'unchanged': True,
                    'next': 'Use status, upgrade or reconcile with this state directory. This repeat did not validate readiness or change the existing profile.'}
        fail('This state already manages an installation. Use its original controller profile; adoption cannot replace it.')
    profile, preview = inspect(inputs, execute, test)
    storage = Path(profile['backupDirectory']).resolve()
    if state.resolve().is_relative_to(storage) or storage.is_relative_to(state.resolve()):
        fail('Controller state and backup storage must be separate directories, neither inside the other.')
    if not confirmation: return preview
    if confirmation != preview['confirmation']: fail('The preview is stale. Inspect the new preview and confirm its new fingerprint; nothing was adopted.')
    with project_lock(profile['daemon']['id'], inputs['project'], state, claim=True, root=lock_root) as claim_directory:
        current, repeated = inspect(inputs, execute, test)
        if repeated['confirmation'] != confirmation:
            if test: print('Synthetic adoption changed fields: ' + ', '.join(changed_fields(profile, current)), flush=True)
            fail('The installation changed during confirmation. Generate a fresh preview.')
        instance = Hosted(state, test=test or None)
        with instance.lock(project_locked=True):
            if instance.pending: fail('Finish the pending controller operation before adoption.')
            if instance.record:
                if instance.record.get('adoptionFingerprint') == confirmation: return {**preview, 'adopted': True, 'unchanged': True}
                fail('This state already manages an installation. Use reconcile for reviewed drift; never overwrite adoption.')
            # Keep a portable image archive even for a private/custom release. Atomic
            # publication allows interrupted saves to be retried without altering Docker.
            private_directory(state)
            target = state / 'adopted-image.tar'; temporary = state / 'adopted-image.partial'
            try:
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600); os.close(fd)
                execute(docker(inputs['context'], 'save', '-o', str(temporary), profile['release']['image']))
                image_identity.verify(image_identity.archive_identity(temporary, json.loads(execute(docker(inputs['context'], 'image', 'inspect', profile['release']['image'])).stdout)[0]),
                                      {key: value for key, value in profile['release']['identity'].items() if key not in {'indexDigest', 'manifestDigest'}})
                with temporary.open('rb') as stream: os.fsync(stream.fileno())
                temporary.replace(target)
            finally: temporary.unlink(missing_ok=True)
            final, final_preview = inspect(inputs, execute, test)
            if final_preview['confirmation'] != confirmation: fail('Installation changed while preserving its image. Generate a fresh preview; no profile was committed.')
            profile['imageArchive'] = {'path': str(target), 'sha256': file_fact(target, True)['sha256']}
            # Only this single atomic record commits adoption. No env/key/Compose
            # copies need to be committed in a second step.
            record = {'version': 2, 'project': inputs['project'], 'domain': urlsplit(profile['origin']).netloc,
                      'database': profile['initialDatabase'], 'backupDirectory': profile['backupDirectory'], 'testOnly': bool(test),
                      'profile': profile, 'adoptionFingerprint': confirmation, 'ownershipDirectory': str(claim_directory),
                      'active': profile['release'], 'adoptedRelease': profile['release']}
            write_json(state / 'installation.json', record)
    return {**preview, 'adopted': True}


def deployment(instance, release):
    """Preserve the adopted topology; change only the shared release/database selection."""
    from hosted import write_json
    profile = instance.record['profile']; config = copy.deepcopy(profile['config'])
    for role in APPLICATION:
        service = config['services'][profile['roles'][role]]
        service['image'] = release['image']; service.pop('build', None); service['pull_policy'] = 'never'
        env = service['environment']; old = urlsplit(env['DATABASE_URL'])
        env['DATABASE_URL'] = urlunsplit(old._replace(path='/' + release['database']))
        env['ATHLETE_PANEL_RELEASE_IDENTITY'] = json.dumps(instance.release_identity(release))
        if role == 'backup': env['ATHLETE_PANEL_BACKUP_RUN'] = release.get('backupRun', '')
    # Use already inspected storage/network identities, never Compose's path/name defaults.
    for kind in ['volumes', 'networks']:
        for name, existing in profile[kind].items(): config[kind][name] = {'external': True, 'name': existing['name']}
    path = instance.state / 'deployment.json'; write_json(path, config)
    return ['docker', 'compose', '-p', instance.record['project'], '-f', str(path)]


def validate_files(profile):
    changed = [path for path, fact in profile['files'].items() if file_fact(path, bool(fact['mode'] & 0o077 == 0)) != fact]
    if changed: fail('Referenced configuration files changed. Run reconcile --dry-run, review the changes and explicitly confirm reconciliation before upgrading.')


def guard(instance, *, files_only=False):
    """Never accept drift automatically, including after an interrupted deployment."""
    profile = instance.record['profile']; validate_files(profile)
    rendered = json.loads(run(project_command(profile['inputs']) + ['config', '--format', 'json']).stdout)
    if rendered != profile['config']: fail('The effective Compose model changed. Preview and confirm reconciliation before continuing.')
    current = endpoint(profile['inputs']['context'], run, bool(instance.test))
    if current != profile['daemon']: fail('Docker endpoint identity changed. Restore the original context or follow the replacement-host recovery runbook.')
    for role in ['web', 'worker', 'backup', 'db'] + (['caddy'] if 'caddy' in profile['roles'] else []):
        name = profile['roles'][role]
        ids = instance.run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + instance.record['project'],
                            '--filter', 'label=com.docker.compose.service=' + name, '--filter', 'label=com.docker.compose.oneoff=False']).stdout.split()
        if len(ids) != 1: fail('A mapped container is missing or replicated. Reconcile the installation before upgrading.')
        item = json.loads(instance.run(['docker', 'inspect', ids[0]]).stdout)[0]
        expected = profile['runtime'][name]
        if sorted(item['Mounts'], key=lambda mount: mount['Destination']) != expected['mounts'] or sorted(item['NetworkSettings']['Networks']) != expected['networks']:
            fail('Running service mounts or networks changed. Reconcile before upgrading.')
        if role in {'db', 'caddy'}:
            if item['Id'] != expected['id'] or sorted(item['Mounts'], key=lambda mount: mount['Destination']) != expected['mounts']: fail('Database/ingress containers or mounts changed. Reconcile before upgrading.')
        elif not instance.pending:
            if item['Id'] != expected['id'] or not instance.image_matches(item['Image'], instance.record['active']): fail('Running application containers changed outside the controller. Reconcile before upgrading.')
        else:
            releases = [instance.record['active'], instance.pending.get('previous'), instance.pending.get('candidate')]
            if not any(release and instance.image_matches(item['Image'], release) for release in releases):
                fail('An unexpected image is running during the interrupted operation. Restore the recorded image before resuming.')

    for name, expected in profile['networks'].items():
        actual = json.loads(instance.run(['docker', 'network', 'inspect', expected['name']]).stdout)[0]
        if actual['Id'] != expected['id']: fail('A Docker network was replaced. Reconcile its recorded identity before upgrading.')
    db_name = profile['roles']['db']; db_id = profile['runtime'][db_name]['id']
    cluster = instance.run(['docker', 'exec', db_id, 'psql', '-U', instance.database_user(), '-d', instance.record['database'], '-Atc',
                            'select system_identifier from pg_control_system()']).stdout.strip()
    if cluster != profile['cluster']: fail('The PostgreSQL cluster identity changed. Restore the intended database or follow explicit recovery.')


def refresh_runtime(instance):
    profile = instance.record['profile']
    for name in profile['runtime']:
        ids = instance.run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + instance.record['project'],
                            '--filter', 'label=com.docker.compose.service=' + name, '--filter', 'label=com.docker.compose.oneoff=False']).stdout.split()
        if len(ids) != 1: fail('Cannot checkpoint an ambiguous deployed service.')
        item = json.loads(instance.run(['docker', 'inspect', ids[0]]).stdout)[0]
        profile['runtime'][name] = {'id': item['Id'], 'image': item['Image'], 'mounts': sorted(item['Mounts'], key=lambda mount: mount['Destination']), 'networks': sorted(item['NetworkSettings']['Networks'])}
    instance.save()


def reconcile(instance, confirmation=None):
    from hosted import write_json
    if not instance.record or not instance.record.get('profile'): fail('Reconciliation is for adopted installations only.')
    if instance.pending: fail('Finish or cancel the pending operation before reconciling configuration.')
    old = instance.record['profile']
    profile, preview = inspect(old['inputs'], test=bool(instance.test), managed=instance)
    if profile['daemon'] != old['daemon'] or profile['cluster'] != old['cluster'] or profile['database'] != old['database']:
        fail('Reconciliation cannot replace the Docker host, database or cluster. Follow explicit recovery instead.')
    if profile['volumes'] != old['volumes'] or profile['networks'] != old['networks'] or profile['roles'] != old['roles']:
        fail('Reconciliation cannot replace storage, networks or service mappings. Restore their recorded identities before upgrading.')
    for role in ['web', 'admin']:
        name = old['roles'][role]
        for key in ['DATABASE_URL', 'ENCRYPTION_KEY', 'APP_DATABASE_PASSWORD', 'APP_DATABASE_ROLE']:
            if profile['config']['services'][name]['environment'].get(key) != old['config']['services'][name]['environment'].get(key):
                fail('Credential/database changes need a separate recovery procedure; reconciliation never rotates or replaces them.')
    if profile['backupKey'] != old['backupKey'] or profile['files'][old['backupKey']] != old['files'][old['backupKey']]:
        fail('The separately recoverable backup key changed. Restore it before proceeding.')
    changes = {'files': [path for path in profile['files'] if profile['files'][path] != old['files'].get(path)],
               'configurationChanged': profile['config'] != old['config'], 'runtimeChanged': profile['runtime'] != old['runtime']}
    result = {'project': instance.record['project'], 'changes': changes, 'confirmation': preview['confirmation']}
    if not confirmation: return result
    if confirmation != result['confirmation']: fail('Reconciliation preview is stale. Review a fresh preview.')
    repeated, _ = inspect(old['inputs'], test=bool(instance.test), managed=instance)
    if fingerprint(repeated) != confirmation: fail('Installation changed during reconciliation. Review a fresh preview.')
    # Retain the initial release and recoverable image across every reconciliation.
    profile['release'] = old['release']; profile['imageArchive'] = old['imageArchive']
    instance.record['profile'] = profile
    write_json(instance.state / 'installation.json', instance.record)
    return {**result, 'reconciled': True}
