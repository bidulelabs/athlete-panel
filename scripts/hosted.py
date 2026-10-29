#!/usr/bin/env python3
"""Guided, owner-initiated VPS operations. Requires Python 3 and Docker Compose, not host Node."""
import argparse
import contextlib
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
REMOTE_FILESYSTEMS = {'nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs'}
IMAGE_ID = re.compile(r'^sha256:[a-f0-9]{64}$')
OPERATION_FORMAT = 2


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


# Existing instance/domain validation works with older hosted-protocol-1 images too.
DATA_CHECK = """import {existsSync} from 'node:fs';
import {connection,closeDatabase} from './packages/host/src/db.ts';
import {loadWorkspace} from './instance/services.ts';
import {validateRetainedMigrations} from './packages/host/src/migrations.ts';
try {
if(existsSync('./scripts/lib/verify-data.ts')) {
const {verifyData}=await import('./scripts/lib/verify-data.ts'); await verifyData();
} else {
await connection().begin('isolation level repeatable read read only',async tx=>{
await validateRetainedMigrations(process.cwd(),await tx`select name,checksum from host.migrations`);
await loadWorkspace(tx,undefined,{records:'all'});
const [owner]=await tx`select count(*)::int as count from host.owner`;
if(owner.count!==1)throw Error('Owner verification failed');});
}
} finally {await closeDatabase();}"""
BACKUP_STATUS = "import {connection,closeDatabase} from './packages/host/src/db.ts'; const rows=await connection()`select key,value from host.settings where key in ('backupAttempt','lastBackup','backupNotification','worker')`; console.log(JSON.stringify(Object.fromEntries(rows.map(r=>[r.key,r.value])))); await closeDatabase();"


def image_reference(value, local=False):
    if local and IMAGE_ID.fullmatch(value): return value
    # Explicit registry host and version/digest avoid implicit Docker Hub/latest choices.
    match = re.fullmatch(r'([a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9][a-z0-9._/-]*)(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})|@sha256:([a-f0-9]{64}))', value or '')
    if local and not match:
        match = re.fullmatch(r'([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})', value or '')
    host = value.split('/', 1)[0] if value else ''
    if not match or match[2] == 'latest' or (not local and not ('.' in host or ':' in host or host == 'localhost')):
        raise OperationError('Use an explicit version or sha256 digest. Registry images need a registry host/repository; latest and unversioned images are refused.')
    return value


def registry_repository(value):
    repository = value.split('@')[0].rsplit(':', 1)[0] if '@' not in value and ':' in value.rsplit('/', 1)[-1] else value.split('@')[0]
    if repository.startswith('docker.io/'):
        repository = repository[len('docker.io/'):]
        if '/' not in repository: repository = 'library/' + repository
    return repository


def valid_metadata(value):
    if (not isinstance(value, dict) or value.get('application') != 'athlete-panel' or value.get('hostedProtocol') != 1
            or not isinstance(value.get('version'), str) or not value['version'] or len(value['version']) > 128
            or not isinstance(value.get('sourceDigest'), str) or not re.fullmatch('[a-f0-9]{64}', value['sourceDigest']) or not isinstance(value.get('plugins'), list)):
        raise OperationError('This image does not support hosted protocol 1. Use a compatible release; no database was migrated.')
    if 'commit' in value and (not isinstance(value['commit'], str) or not re.fullmatch('[a-f0-9]{40}', value['commit'])):
        raise OperationError('Invalid image commit identity.')
    return value


class OperationError(Exception):
    pass


class WorkerHeartbeatTimeout(OperationError):
    pass


def default_state(home=None):
    home = Path(home) if home is not None else Path.home()
    return home / '.local/share/athlete-panel/hosted'


def storage_marker(destination):
    return Path(destination) / '.athlete-panel-storage-id'


def private_directory(path):
    path = Path(path)
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    if path.is_symlink() or not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise OperationError('Use a private state directory owned by your account (mode 0700), without symlinks.')
    return path.resolve()


def write_json(path, value):
    """Publish complete private state, including a durable operation checkpoint."""
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(value, output, indent=2); output.write('\n'); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path, default=None):
    path = Path(path)
    if not path.exists(): return default
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise OperationError('Hosted state files must be private regular files owned by your account.')
    return json.loads(path.read_text())


def parse_configuration(path):
    """Read only generator-produced quoted dotenv values; never execute shell content."""
    path = Path(path); info = path.lstat()
    if not path.is_file() or path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise OperationError('Restore the private generated configuration with mode 0600.')
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'): continue
        key, separator, encoded = line.partition('=')
        if not separator or not re.fullmatch('[A-Z_]+', key): raise OperationError('Invalid generated configuration.')
        value = json.loads(encoded)
        if not isinstance(value, str): raise OperationError('Invalid generated configuration.')
        values[key] = value
    values.setdefault('POSTGRES_USER', 'athlete_panel')
    values.setdefault('APP_DATABASE_ROLE', 'athlete_panel_app')
    return values


def mount_identity(path, mount_info=None):
    """Select the enclosing mount, not merely a directory that happens to exist."""
    if mount_info is None:
        try: mount_info = Path('/proc/self/mountinfo').read_text()
        except OSError: raise OperationError('Hosted remote-storage checks require Linux. Use the isolated rehearsal for development.') from None
    unescape = lambda text: re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), text)
    path = str(Path(path).resolve()); matches = []
    for line in mount_info.splitlines():
        left, separator, right = line.partition(' - ')
        if not separator: continue
        fields = left.split(); details = right.split()
        if len(fields) < 5 or len(details) < 2: continue
        mount = unescape(fields[4])
        if path == mount or path.startswith(mount.rstrip('/') + '/'):
            filesystem, source = details[0], unescape(details[1])
            matches.append((len(mount), filesystem, source))
    if not matches: raise OperationError('Cannot identify the backup filesystem.')
    _, filesystem, source = max(matches)
    return filesystem, hashlib.sha256((filesystem + '\0' + source).encode()).hexdigest()


class Hosted:
    def __init__(self, state, test=None):
        if Path(state).resolve().is_relative_to(ROOT.resolve()):
            raise OperationError('Keep private hosted state outside the source checkout so it cannot enter an image or source backup.')
        self.state = private_directory(state)
        self.test = test  # Supplied only by the imported isolated harness, never a CLI/environment bypass.
        self.record = read_json(self.state / 'installation.json')
        self.pending = read_json(self.state / 'operation.json')
        if self.record and (self.record.get('version') != 1 or not re.fullmatch(r'athlete-panel-hosted-[a-f0-9]{10}', self.record.get('project', ''))):
            raise OperationError('Unsupported hosted state. Preserve it and use its matching controller version.')
        if self.record and bool(self.record.get('testOnly')) != bool(test):
            raise OperationError('Synthetic and real hosted state cannot be interchanged.')

    @contextlib.contextmanager
    def lock(self):
        fd = os.open(self.state / 'operation.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise OperationError('Another hosted operation is running. Wait for it to finish.') from None
            # Another operation may have completed between construction and acquiring the lock.
            self.record = read_json(self.state / 'installation.json')
            self.pending = read_json(self.state / 'operation.json')
            yield
        finally: os.close(fd)

    def run(self, args, *, data=None, check=True, timeout=1800):
        # Do not inherit application secrets, Compose overrides or the checkout's .env.
        env = {key: value for key, value in os.environ.items() if key in {'PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR', 'SSH_AUTH_SOCK'}}
        result = subprocess.run([str(arg) for arg in args], input=data, text=True, capture_output=True, env=env, timeout=timeout)
        if len(args) > 1 and args[0] == 'docker' and args[1] == 'build':
            descriptor = os.open(self.state / 'build.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as output: output.write(result.stdout + result.stderr)
            if check and result.returncode:
                raise OperationError('Image build failed. Inspect build.log in the private state directory, correct the candidate source and resume. This build did not alter the database or reopen writes.')
        if check and result.returncode:
            if self.test:
                diagnostic = result.stderr[-2500:]
                config = self.state / '.env'
                if config.exists():
                    for key, value in parse_configuration(config).items():
                        if ('PASSWORD' in key or 'KEY' in key) and value: diagnostic = diagnostic.replace(value, '[redacted]')
                if data: diagnostic = diagnostic.replace(data.strip(), '[redacted]')
                print('Synthetic rehearsal diagnostic: ' + diagnostic, file=sys.stderr)
            if args[:2] == ['docker', 'pull']:
                raise OperationError('Image download failed. Check the version/digest, registry login, network and CPU architecture, then resume. Downloading does not migrate the database or switch the installed release.')
            if 'scripts/migrate.ts' in args:
                phase = 'permission refresh after committed migrations' if result.returncode == 2 else 'migration validation or SQL (transaction rolled back)'
                raise OperationError('Failed during ' + phase + '. Keep maintenance enabled; correct the candidate/configuration and resume, or recover the recorded backup.')
            if 'upgrade-check' in args and result.returncode == 3:
                raise OperationError('Candidate removes or disables installed plugins. Cancel preparation, preserve them in a custom image, or explicitly review --accept-custom-changes. No migration started.')
            raise OperationError('Container operation failed. Existing data was retained. Check Docker availability, disk space and service logs; then resume. No private command output was printed.')
        return result

    def save(self): write_json(self.state / 'installation.json', self.record)
    def checkpoint(self): write_json(self.state / 'operation.json', self.pending)

    def step(self, name, function):
        if name in self.pending['completed']: return
        self.pending['phase'] = name
        attempt = {'phase': name, 'startedAt': timestamp(), 'state': 'running'}
        self.pending.setdefault('attempts', []).append(attempt); self.checkpoint()
        print(name.replace('-', ' ').capitalize() + '…', flush=True)
        started = time.monotonic()
        try:
            function()
        except BaseException:
            attempt.update(state='failed', finishedAt=timestamp(), seconds=round(time.monotonic() - started, 3))
            self.checkpoint()
            raise
        attempt.update(state='succeeded', finishedAt=timestamp(), seconds=round(time.monotonic() - started, 3))
        print(f"{name}: completed in {attempt['seconds']:.1f}s", flush=True)
        self.pending['completed'].append(name); self.checkpoint()

    def begin(self, kind, **values):
        if self.pending: raise OperationError('An operation is pending. Use resume, or recover its recorded backup before starting another operation.')
        self.pending = {'format': OPERATION_FORMAT, 'kind': kind, 'id': uuid.uuid4().hex,
                        'startedAt': timestamp(), 'completed': [], 'attempts': [], **values}
        if getattr(self, 'expected_commit', None): self.pending['expectedCommit'] = self.expected_commit
        self.checkpoint()

    def docker_ready(self):
        self.run(['docker', 'info'], timeout=30)
        self.run(['docker', 'compose', 'version'], timeout=30)

    def verify_storage(self):
        destination = Path(self.record['backupDirectory'])
        if self.state.is_relative_to(destination.resolve()) or destination.resolve().is_relative_to(self.state):
            raise OperationError('Operator keys/state and archive storage must be separate directories, neither inside the other.')
        if destination.is_symlink() or not destination.is_dir(): raise OperationError('The registered backup directory is unavailable.')
        policy = read_json(self.state / '.secrets' / 'backup-storage.json')
        if not policy: raise OperationError('Backup storage has not been registered.')
        if not self.test:
            filesystem, fingerprint = mount_identity(destination)
            if filesystem not in REMOTE_FILESYSTEMS or fingerprint != policy['mountFingerprint']:
                raise OperationError('The registered remote backup mount is absent or changed. Restore the mount before retrying.')
        marker = storage_marker(destination)
        if marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != policy['id']:
            raise OperationError('The registered backup storage identity is missing or changed.')
        # No directory creation here: an absent mount must never fall back to local storage.
        probe = destination / ('.athlete-panel-write-' + uuid.uuid4().hex)
        try:
            fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as output: output.write('storage-check'); output.flush(); os.fsync(output.fileno())
            if probe.read_text() != 'storage-check': raise OperationError('Backup destination read-back failed.')
        finally: probe.unlink(missing_ok=True)

    def register_storage(self):
        destination = Path(self.record['backupDirectory'])
        if destination.is_symlink() or not destination.is_dir(): raise OperationError('Create and mount the remote backup directory first.')
        if self.test: fingerprint = '0' * 64
        else:
            filesystem, fingerprint = mount_identity(destination)
            if filesystem not in REMOTE_FILESYSTEMS: raise OperationError('Use a mounted NFS, SMB or SSHFS remote destination. A local directory is not off-host protection.')
        secrets_dir = private_directory(self.state / '.secrets')
        policy_file = secrets_dir / 'backup-storage.json'
        if not policy_file.exists():
            marker = storage_marker(destination)
            expected_identity = str(uuid.UUID(hex=self.pending['id'])) if self.pending and self.pending['kind'] == 'install' else str(uuid.uuid4())
            try:
                fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'w') as output: output.write(expected_identity + '\n'); output.flush(); os.fsync(output.fileno())
            except FileExistsError:
                if marker.is_symlink() or not marker.is_file(): raise OperationError('Unsafe backup identity marker.') from None
            identity = marker.read_text().strip()
            if identity != expected_identity: raise OperationError('This backup directory belongs to another installation. Recover its operator state or choose an unused directory; its marker and archives were preserved.')
            write_json(policy_file, {'version': 1, 'id': identity, 'mountFingerprint': fingerprint, 'testOnly': bool(self.test)})
        self.verify_storage()

    def prepare_image(self, source=None, key='candidate', supplied=None, remote=None, local=None, expected=None):
        """Resolve once, persist the immutable ID, then extract controls without running the image."""
        platform = ['--platform', self.test['platform']] if self.test and self.test.get('platform') else []
        resolved = (self.pending or {}).get('resolvedImages', {}).get(key)
        if not resolved:
            if supplied and self.test: local = supplied
            if remote:
                image_reference(remote)
                self.run(['docker', 'pull', *platform, remote])
                image, origin = remote, {'kind': 'registry', 'requested': remote}
            elif local:
                image_reference(local, local=True)
                image, origin = local, {'kind': 'local', 'requested': local}
            else:
                source = Path(source or ROOT).resolve()
                if self.state.is_relative_to(source): raise OperationError('Candidate source must not contain the private hosted state directory.')
                if not (source / 'Dockerfile').is_file(): raise OperationError('Choose --image, --local-image or a source directory containing Dockerfile.')
                image = f"{self.record['project']}:{self.pending['id']}-{key}"
                build_args = ['--build-arg', 'ATHLETE_PANEL_COMMIT=' + expected['commit']] if expected and expected.get('commit') else []
                self.run(['docker', 'build', *platform, *build_args, '-t', image, str(source)], timeout=3600)
                origin = {'kind': 'source'}
            info = json.loads(self.run(['docker', 'image', 'inspect', image]).stdout)[0]
            image_id = info['Id']
            if not IMAGE_ID.fullmatch(image_id) or info.get('Os') != 'linux': raise OperationError('A Linux image with an immutable image ID is required.')
            if not self.test:
                architecture = self.run(['docker', 'version', '--format', '{{.Server.Arch}}']).stdout.strip()
                if info.get('Architecture') != architecture:
                    raise OperationError('Candidate image architecture differs from this server. Select a compatible custom image or supported release before maintenance.')
            registry_ref = None
            if remote:
                refs = [ref for ref in info.get('RepoDigests', []) if registry_repository(ref) == registry_repository(remote)]
                if not refs: raise OperationError('The pulled image has no matching registry digest; it was not activated.')
                registry_ref = remote if '@sha256:' in remote else refs[0]
                if remote.startswith('docker.io/') and not registry_ref.startswith('docker.io/'):
                    registry_ref = 'docker.io/' + registry_ref
                image_reference(registry_ref)
            resolved = {'image': image_id, 'registryRef': registry_ref, 'origin': origin}
            self.pending.setdefault('resolvedImages', {})[key] = resolved; self.checkpoint()
        image_id = resolved['image']
        if self.run(['docker', 'image', 'inspect', image_id], check=False).returncode:
            if not resolved.get('registryRef'): raise OperationError('The prepared local image is missing. Restore that image or cancel preparation/start recovery; a different image was not substituted.')
            self.run(['docker', 'pull', *platform, resolved['registryRef']])
            restored_id = self.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', resolved['registryRef']]).stdout.strip()
            if restored_id != image_id: raise OperationError('The pinned image does not match this server platform. Start a reviewed recovery with compatible tools.')
        directory = private_directory(self.state / ('release-' + self.pending['id'] + '-' + key))
        container = self.run(['docker', 'create', image_id]).stdout.strip()
        try:
            for filename in ['compose.yml', 'Caddyfile']:
                self.run(['docker', 'cp', container + ':/app/' + filename, directory / filename])
            metadata_path = directory / 'image-metadata.json'
            result = self.run(['docker', 'cp', container + ':/app/.athlete-panel-release.json', metadata_path], check=False)
            if result.returncode:
                raise OperationError('Image release metadata is missing. Rebuild this source with image-workflow support; existing installations were not modified.')
            metadata = valid_metadata(json.loads(metadata_path.read_text()))
        finally: self.run(['docker', 'rm', container], check=False)
        if expected and (not metadata or metadata['sourceDigest'] != expected['sourceDigest'] or metadata['version'] != expected['version'] or metadata.get('commit') != expected.get('commit')):
            raise OperationError('Recovery image differs from the authenticated archive source. No release switch was performed.')
        if self.test:
            path = directory / 'Caddyfile'; path.write_text(path.read_text().replace('{$ATHLETE_PANEL_DOMAIN} {', 'localhost {\n    tls internal'))
        if key == 'candidate' and self.pending.get('expectedCommit') and metadata.get('commit') != self.pending['expectedCommit']:
            raise OperationError('Image commit differs from its deployment bundle. No release was activated.')
        self.pending[key] = {**resolved, 'metadata': metadata, 'controls': str(directory),
                             'database': self.record.get('active', {}).get('database', self.record.get('database', 'athlete_panel'))}
        self.checkpoint()

    def prepare_candidate(self, key='candidate'):
        self.prepare_image(self.pending.get('source'), key=key, supplied=self.pending.get('suppliedImage'),
                           remote=self.pending.get('imageRef'), local=self.pending.get('localImage'))

    def validate_upgrade(self):
        previous, candidate = self.pending['previous'], self.pending['candidate']
        accepted = self.pending.get('acceptCustomChanges', False)
        old_origin = previous.get('origin', {})
        if candidate.get('origin', {}).get('kind') == 'registry' and not accepted:
            if old_origin.get('kind') != 'registry' or registry_repository(old_origin.get('requested', '')) != registry_repository(candidate['origin']['requested']):
                raise OperationError('This would replace a custom/older build or change image publishers. Preserve your code/plugins in a custom image, or explicitly review and use --accept-custom-changes. No maintenance or migration started.')
        arguments = ['--accept-plugin-removals'] if accepted else []
        self.console(candidate, 'web', 'scripts/hosted-console.ts', 'upgrade-check', *arguments)

    def recovery_tools(self):
        if self.pending.get('source') or self.pending.get('imageRef') or self.pending.get('localImage') or self.pending.get('suppliedImage'):
            self.prepare_candidate('tools'); return
        previous = self.pending['previous']
        image = previous['image']
        if self.run(['docker', 'image', 'inspect', image], check=False).returncode == 0:
            self.prepare_image(key='tools', local=image); return
        if previous.get('registryRef'):
            self.prepare_image(key='tools', remote=previous['registryRef']); return
        if (ROOT / 'Dockerfile').is_file():
            self.prepare_image(ROOT, key='tools'); return
        raise OperationError('Recovery tools are unavailable. Supply a compatible --image, --local-image or --source; preserve the original keys and archive.')

    def recovered_image(self, source):
        identity = self.pending['archiveMetadata'].get('release')
        if not identity or self.pending.get('rebuildSource'):
            self.prepare_image(source, expected=identity); return
        if self.run(['docker', 'image', 'inspect', identity['imageId']], check=False).returncode == 0:
            self.prepare_image(local=identity['imageId'], expected=identity)
            self.pending['candidate']['origin'] = {'kind': identity['kind'], 'requested': identity.get('registryRef') or identity['imageId']}
            self.pending['candidate']['registryRef'] = identity.get('registryRef'); self.checkpoint(); return
        if identity.get('registryRef'):
            self.prepare_image(remote=identity['registryRef'], expected=identity); return
        raise OperationError('The archived custom image is unavailable. Load its saved image, or run recovery again with --rebuild-source to rebuild the authenticated matching source.')

    def configure(self):
        config = self.state / '.env'
        if config.exists(): parse_configuration(config); return
        if self.run(['docker', 'volume', 'inspect', self.record['project'] + '_database'], check=False).returncode == 0:
            raise OperationError('Database storage already exists but configuration is missing. Restore the original .env and keys; new credentials were not generated.')
        self.run(['docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', f'{os.getuid()}:{os.getgid()}',
                  '-v', str(self.state) + ':/config', '-v', self.record['backupDirectory'] + ':' + self.record['backupDirectory'],
                  self.pending['candidate']['image'], 'node', '--import', 'tsx', '--input-type=module', '-e',
                  "import {configureHosted} from './scripts/configure-hosted.ts'; await configureHosted('/config',process.argv[1],process.argv[2],process.argv[3]);",
                  self.record['domain'], self.record['backupDirectory'], self.pending['id']])

    def deployment(self, release):
        values = parse_configuration(self.state / '.env')
        values.update(ATHLETE_PANEL_DOMAIN=self.record['domain'], ATHLETE_PANEL_RELEASE='managed', POSTGRES_DB=release['database'],
                      BACKUP_DESTINATION=self.record['backupDirectory'], BACKUP_KEY_FILE=str(self.state / '.secrets' / 'backup-key'))
        temporary = self.state / 'compose.env'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            for key, value in values.items(): output.write(key + '=' + json.dumps(value) + '\n')
        controls = Path(release['controls'])
        result = self.run(['docker', 'compose', '--env-file', temporary, '-p', self.record['project'], '-f', controls / 'compose.yml', '--profile', 'backup', '--profile', 'tools', 'config', '--format', 'json'])
        config = json.loads(result.stdout); temporary.unlink()
        if not re.match(r'^postgres:17(?:[-.@]|$)', config['services']['db']['image']):
            raise OperationError('This controller supports PostgreSQL 17 only. A database major-version upgrade requires its own tested procedure.')
        config['name'] = self.record['project']
        origin = self.origin()
        for name in ['web', 'worker', 'admin', 'backup', 'recovery']:
            service = config['services'][name]; service['image'] = release['image']; service.pop('build', None)
            service['pull_policy'] = 'never'
            service['environment']['APP_ORIGIN'] = origin
            role = values['APP_DATABASE_ROLE']
            administrative = name in {'admin', 'recovery'}
            user = values['POSTGRES_USER'] if administrative else role
            password = values['POSTGRES_PASSWORD'] if administrative else values['APP_DATABASE_PASSWORD']
            service['environment']['DATABASE_URL'] = f"postgresql://{user}:{password}@db:5432/{release['database']}"
            if name == 'admin': service['environment']['APP_DATABASE_ROLE'] = role
            if release.get('metadata'):
                service['environment']['ATHLETE_PANEL_RELEASE_IDENTITY'] = json.dumps({
                    'imageId': release['image'], 'registryRef': release.get('registryRef'),
                    'kind': release.get('origin', {}).get('kind', 'source'),
                    'sourceDigest': release['metadata']['sourceDigest'], 'version': release['metadata']['version'],
                    **({'commit': release['metadata']['commit']} if release['metadata'].get('commit') else {})})
        for name in ['backup', 'recovery']:
            service = config['services'][name]; service['user'] = f'{os.getuid()}:{os.getgid()}'; service.pop('cap_add', None)
            service['environment']['BACKUP_STORAGE_POLICY'] = '/run/secrets/backup_storage'
            service.setdefault('volumes', []).append({'type': 'bind', 'source': str(self.state / '.secrets' / 'backup-storage.json'), 'target': '/run/secrets/backup_storage', 'read_only': True, 'bind': {'create_host_path': False}})
            for volume in service['volumes']:
                if volume['type'] == 'bind': volume.setdefault('bind', {})['create_host_path'] = False
        config['services']['backup']['environment']['ATHLETE_PANEL_BACKUP_RUN'] = release.get('backupRun', '')
        heartbeat = self.state / '.secrets' / 'backup-heartbeat.json'
        if heartbeat.exists():
            read_json(heartbeat)  # Enforce private ownership before mounting the optional secret.
            config['services']['backup']['environment']['BACKUP_HEARTBEAT_FILE'] = '/run/secrets/backup_heartbeat'
            config['services']['backup']['volumes'].append({'type': 'bind', 'source': str(heartbeat), 'target': '/run/secrets/backup_heartbeat', 'read_only': True, 'bind': {'create_host_path': False}})
        # Adopt the old controller's existing mount once, then keep it stable across releases.
        if not self.record.get('ingress'):
            active_controls = self.record.get('active', {}).get('controls')
            existing = Path(active_controls) / 'Caddyfile' if active_controls else None
            self.record['ingress'] = str(existing if existing and existing.is_file() else private_directory(self.state / 'ingress') / 'Caddyfile')
            self.save()
        ingress = Path(self.record['ingress'])
        if not ingress.is_relative_to(self.state):
            # A recovery kit moved to a new operator directory has no usable old mount.
            ingress = private_directory(self.state / 'ingress') / 'Caddyfile'
            self.record['ingress'] = str(ingress); self.save()
        if not ingress.exists():
            private_directory(ingress.parent)
            current = self.record.get('active') or release
            source = Path(current['controls']) / 'Caddyfile'
            if not source.exists(): source = Path(release['controls']) / 'Caddyfile'
            ingress.write_bytes(source.read_bytes())
        for volume in config['services']['caddy'].get('volumes', []):
            if volume.get('target') == '/etc/caddy/Caddyfile': volume['source'] = str(ingress)
        if self.test:
            config['services']['caddy']['ports'] = [{'target': 443, 'published': str(self.test['port']), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        # Keep the cluster's initial database stable when switching to a restored database.
        config['services']['db']['environment']['POSTGRES_DB'] = self.record['database']
        config['services']['db']['environment']['POSTGRES_USER'] = values['POSTGRES_USER']
        config['services']['db']['healthcheck']['test'] = ['CMD-SHELL', 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
        path = self.state / 'deployment.json'; write_json(path, config)
        return ['docker', 'compose', '-p', self.record['project'], '-f', str(path)]

    def compose(self, release, args, **kwargs): return self.run(self.deployment(release) + args, **kwargs)

    def database_user(self): return parse_configuration(self.state / '.env')['POSTGRES_USER']

    def console(self, release, service, script, *args, data=None, extra=None):
        labels = ['--label', 'io.athlete-panel.operation=' + self.pending['id']] if self.pending else []
        result = self.compose(release, ['run', '--rm', '--no-deps', '-T', *labels, *(extra or []), service, 'node', '--import', 'tsx', script, *args], data=data)
        return result.stdout.strip()

    def reconcile_commands(self):
        containers = self.run(['docker', 'ps', '-q', '--filter', 'label=io.athlete-panel.operation=' + self.pending['id']]).stdout.split()
        for container in containers:
            print('Waiting for the interrupted operation’s container to finish…', flush=True)
            self.run(['docker', 'wait', container], check=False)

    def maintenance(self, release, enabled):
        if enabled and not self.pending.get('maintenanceStartedAt'):
            self.pending['maintenanceStartedAt'] = timestamp(); self.checkpoint()
        self.console(release, 'web', 'scripts/operations.ts', 'maintenance', 'on' if enabled else 'off')
        if not enabled:
            self.pending['reopenedAt'] = timestamp(); self.checkpoint()

    def start_backups(self, candidate):
        candidate['backupRun'] = uuid.uuid4().hex
        self.pending['backupStartedAt'] = timestamp(); self.checkpoint()
        if self.record.get('active', {}).get('image') == candidate['image']:
            self.record['active'] = candidate; self.save()
        self.compose(candidate, ['--profile', 'backup', 'up', '-d', '--no-deps', 'backup'])

    def await_backup(self, candidate):
        started = self.pending['backupStartedAt']
        container = self.compose(candidate, ['--profile', 'backup', 'ps', '-q', 'backup']).stdout.strip()
        if not container or self.run(['docker', 'inspect', '--format', '{{.Image}}', container]).stdout.strip() != candidate['image']:
            raise OperationError('Application deployed, backup failed: the selected backup service is not running. Resume to retry it.')
        for _ in range(360):
            status = self.backup_status(candidate)
            attempt, latest = status.get('backupAttempt') or {}, status.get('lastBackup') or {}
            matches = attempt.get('startedAt', '') >= started and attempt.get('runId', candidate['backupRun']) == candidate['backupRun']
            if matches and attempt.get('state') == 'failed': break
            if (matches and attempt.get('state') == 'succeeded' and latest.get('completedAt', '') >= started
                    and latest.get('verifiedAt') and latest.get('kind') == 'daily'
                    and latest.get('runId', candidate['backupRun']) == candidate['backupRun']
                    and latest.get('imageId', candidate['image']) == candidate['image']):
                self.pending['verifiedBackup'] = latest; self.checkpoint()
                if attempt.get('retention') == 'failed':
                    print('Backup verified; retention cleanup failed. Inspect backup storage permissions and logs. The next daily run retries retention.', flush=True)
                return
            time.sleep(5)
        raise OperationError('Application deployed, backup failed or did not complete in time. Normal use remains open. Inspect backup logs/storage, then resume to retry only the backup service.')

    def finish(self):
        self.pending.update(phase='complete', finishedAt=timestamp())
        elapsed = lambda start, end: round((datetime.fromisoformat(end.replace('Z', '+00:00')) - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds(), 3)
        self.pending['seconds'] = elapsed(self.pending['startedAt'], self.pending['finishedAt'])
        if self.pending.get('maintenanceStartedAt') and self.pending.get('reopenedAt'):
            self.pending['maintenanceSeconds'] = elapsed(self.pending['maintenanceStartedAt'], self.pending['reopenedAt'])
        write_json(self.state / ('completed-' + self.pending['id'] + '.json'), self.pending)
        (self.state / 'operation.json').unlink(); self.pending = None

    def rehearsal(self, archive, candidate=None):
        from hosted_rehearsal import rehearse
        return rehearse(self, Path(archive), candidate)

    def restore_test(self, archive=None):
        if not self.record or not self.record.get('active'): raise OperationError('A managed installation and its recovery keys are required.')
        if archive is None:
            latest = self.backup_status(self.record['active']).get('lastBackup') or {}
            filename = latest.get('file', '')
            if not filename or Path(filename).name != filename: raise OperationError('No completed backup is recorded. Create a backup or supply --archive.')
            archive = Path(self.record['backupDirectory']) / filename
        self.begin('restore-test', archive=str(Path(archive).resolve()), previous=self.record['active'])
        self.resume()

    def origin(self): return f"https://localhost:{self.test['port']}" if self.test else 'https://' + self.record['domain']

    def ready(self, release):
        self.console(release, 'web', 'scripts/operations.ts', 'verify-schema')
        self.verify_data(release)
        fresh_after = timestamp()
        self.compose(release, ['up', '-d', '--wait', '--no-deps', 'web', 'worker'], timeout=180)
        ingress = Path(self.record['ingress'])
        contents = (Path(release['controls']) / 'Caddyfile').read_bytes()
        changed = ingress.read_bytes() != contents
        digest = hashlib.sha256(contents).hexdigest()
        reload_state = (self.pending or {}).get('ingressReload', {})
        reload_needed = changed or reload_state.get('state') == 'pending'
        if reload_needed:
            if not self.pending:
                raise OperationError('Changed ingress requires a recorded upgrade or recovery operation. Use upgrade or resume before activating it.')
            # Persist intent before either validation or the live-file write. A successful
            # reload can safely be repeated after losing its completion checkpoint.
            self.pending['ingressReload'] = {'sha256': digest, 'state': 'pending'}; self.checkpoint()
            self.compose(release, ['run', '--rm', '--no-deps', '-T', '--label', 'io.athlete-panel.operation=' + self.pending['id'],
                                  '-v', str(Path(release['controls']) / 'Caddyfile') + ':/etc/caddy/candidate:ro',
                                  'caddy', 'caddy', 'validate', '--config', '/etc/caddy/candidate', '--adapter', 'caddyfile'])
            # Preserve the inode of the bind-mounted file; only readiness activates candidate ingress.
            with ingress.open('wb') as output:
                output.write(contents); output.flush(); os.fsync(output.fileno())
        self.compose(release, ['up', '-d', '--no-deps', 'caddy'], timeout=180)
        if reload_needed:
            self.compose(release, ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'])
            self.pending['ingressReload'] = {'sha256': digest, 'state': 'applied'}; self.checkpoint()
        self.running_health(release, fresh_after)

    def verify_deployed(self, release):
        self.console(release, 'web', 'scripts/operations.ts', 'verify-schema')
        self.verify_data(release)
        self.running_health(release, timestamp())

    def running_health(self, release, after):
        container = self.compose(release, ['ps', '-q', 'web']).stdout.strip()
        if not container or self.run(['docker', 'inspect', '--format', '{{.Image}}', container]).stdout.strip() != release['image']:
            raise OperationError('The selected web service is not running. Inspect service logs and correct it before resuming.')
        context = ssl.create_default_context()
        if self.test:
            container = self.compose(release, ['ps', '-q', 'caddy']).stdout.strip()
            certificate = self.state / 'test-ca.crt'
            for _ in range(30):
                result = self.run(['docker', 'cp', container + ':/data/caddy/pki/authorities/local/root.crt', certificate], check=False)
                if result.returncode == 0: break
                time.sleep(1)
            context = ssl.create_default_context(cafile=str(certificate))
        for _ in range(60):
            try:
                with urllib.request.urlopen(self.origin() + '/api/health', context=context, timeout=5) as response:
                    if response.status == 200: break
            except (OSError, ValueError): pass
            time.sleep(2)
        else: raise OperationError('HTTPS readiness failed. Check DNS, ports 80/443 and Caddy logs, then resume. Read status before choosing recovery.')
        self.fresh_worker(release, after)

    def verify_data(self, release):
        self.compose(release, ['run', '--rm', '--no-deps', '-T', 'web', 'node', '--import', 'tsx', '--input-type=module', '-e', DATA_CHECK])

    def backup_status(self, release):
        # Use stable infrastructure imports so archived releases need no newer console command.
        return json.loads(self.compose(release, ['run', '--rm', '--no-deps', '-T', 'web', 'node', '--import', 'tsx', '--input-type=module', '-e', BACKUP_STATUS]).stdout)

    def runtime_status(self):
        # Read the running service directly: status must never rewrite shared Compose state.
        if not self.record: return None
        try:
            container = self.run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + self.record['project'],
                                  '--filter', 'label=com.docker.compose.service=web', '--filter', 'label=com.docker.compose.oneoff=False'], timeout=10).stdout.strip()
            if not container: return {'available': False}
            return json.loads(self.run(['docker', 'exec', container, 'node', '--import', 'tsx', '--input-type=module', '-e', BACKUP_STATUS], timeout=10).stdout)
        except (OperationError, OSError, ValueError, subprocess.SubprocessError): return {'available': False}

    def fresh_worker(self, release, after, states=None):
        container = self.compose(release, ['ps', '-q', 'worker']).stdout.strip()
        actual = self.run(['docker', 'inspect', '--format', '{{.Image}}', container]).stdout.strip()
        if actual != release['image']: raise OperationError('The running worker is not the selected image. Inspect service configuration before resuming.')
        for _ in range(45):
            worker = self.backup_status(release).get('worker') or {}
            if worker.get('lastSeen', '') >= after and worker.get('state') in (states or {'healthy', 'maintenance'}): return
            time.sleep(2)
        raise WorkerHeartbeatTimeout('The selected worker has not reported a fresh healthy heartbeat. Inspect worker logs and resume.')

    def drain_work(self, release):
        # Maintenance has drained serialized writes. Wait for any external job iteration
        # to finish too, before choosing the final snapshot. A stopped worker is drained.
        if self.compose(release, ['ps', '-q', 'worker']).stdout.strip():
            try:
                self.fresh_worker(release, timestamp(), {'maintenance'})
            except WorkerHeartbeatTimeout:
                print('Previous worker did not drain in time. Stopping it before the final recovery snapshot…', flush=True)
                self.compose(release, ['stop', '--timeout', '30', 'worker'], timeout=60)
                if self.compose(release, ['ps', '-q', 'worker']).stdout.strip():
                    raise OperationError('Previous worker is still running. Keep maintenance enabled, stop the worker and resume; no final snapshot or migration was started.')

    def backup(self, release=None):
        if release is None and self.pending: raise OperationError('Resume the pending operation before creating another manual backup.')
        release = release or self.record.get('active')
        if not release: raise OperationError('No installed release is available for backup.')
        self.verify_storage()
        result = json.loads(self.console(release, 'backup', 'scripts/hosted-console.ts', 'backup'))
        if result.get('verified') is not True or Path(result.get('file', '')).name != result.get('file'):
            raise OperationError('Backup did not report a verified archive.')
        return result

    def verify_archive(self, archive, release=None):
        archive = Path(archive).resolve()
        if not archive.is_file(): raise OperationError('Select an existing encrypted .fgr archive.')
        release = release or self.record.get('active') or self.pending.get('candidate')
        result = self.console(release, 'recovery', 'scripts/verify-backup.ts', '/selected/' + archive.name,
                              extra=['-v', str(archive.parent) + ':/selected:ro'])
        return json.loads(result)

    def install(self, source, domain, backup_directory, password=None, image=None, image_ref=None, local_image=None):
        if self.pending: raise OperationError('Use resume to continue the pending installation.')
        if self.record and self.record.get('active'): raise OperationError('This installation is already configured. Use upgrade; passwords and keys were preserved.')
        if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain): raise OperationError('Enter a DNS hostname without https:// or a port.')
        destination = Path(backup_directory).absolute()
        if self.state.is_relative_to(destination.resolve()) or destination.resolve().is_relative_to(self.state):
            raise OperationError('Keep private operator state separate from archive storage.')
        if any(char in str(destination) for char in ':,$\n\r'):
            raise OperationError('Use a backup directory without colon, comma, dollar sign or line breaks.')
        if destination.is_symlink() or not destination.is_dir(): raise OperationError('Create and mount the remote backup directory first.')
        if not self.record and (storage_marker(destination).exists() or storage_marker(destination).is_symlink() or any(destination.glob('*.fgr'))):
            raise OperationError('Backup storage already contains an installation. Recover its operator state or choose an unused directory. No new keys were generated.')
        if self.record and (self.record['domain'] != domain or self.record['backupDirectory'] != str(destination)):
            raise OperationError('An interrupted installation has different domain/storage settings. Preserve its state and use the original values.')
        self.record = self.record or {'version': 1, 'project': 'athlete-panel-hosted-' + secrets.token_hex(5), 'domain': domain, 'backupDirectory': str(destination), 'database': 'athlete_panel_test' if self.test else 'athlete_panel', 'testOnly': bool(self.test)}
        self.save(); self.begin('install', source=str(Path(source).resolve()) if source else None,
                               suppliedImage=image if self.test else None, imageRef=image_ref, localImage=local_image)
        self.resume(password=password)

    def upgrade(self, source=None, image=None, image_ref=None, local_image=None, accept_custom_changes=False):
        if not self.record or not self.record.get('active'): raise OperationError('Install a managed instance first. Existing manual installations keep their documented advanced upgrade path.')
        self.begin('upgrade', source=str(Path(source).resolve()) if source else None, previous=self.record['active'],
                   suppliedImage=image if self.test else None, imageRef=image_ref, localImage=local_image,
                   acceptCustomChanges=accept_custom_changes)
        self.resume()

    def cancel(self):
        safe = {'prepare-image', 'validate-upgrade-source', 'prepare-rehearsal-backup', 'rehearse-candidate'}
        restore_test = self.pending and self.pending['kind'] == 'restore-test'
        if not restore_test and (not self.pending or self.pending['kind'] != 'upgrade' or not set(self.pending['completed']).issubset(safe) or self.pending.get('phase') not in safe | {None}):
            raise OperationError('Only upgrade preparation or a restore test can be cancelled. Once maintenance may have started, resume or recover its recorded backup instead.')
        self.reconcile_commands()
        if self.pending.get('rehearsal'):
            from hosted_rehearsal import cleanup
            cleanup(self, self.pending['rehearsal']['id'])
        write_json(self.state / ('cancelled-' + self.pending['id'] + '.json'), self.pending)
        (self.state / 'operation.json').unlink(); self.pending = None
        print('Preparation/test cancelled. The installed release, credentials and database were unchanged.')

    def select_release(self, candidate):
        # A crash between save and checkpoint must not replace the previous release with itself.
        self.record['previous'] = self.pending.get('previous', self.record.get('previous'))
        self.record['active'] = candidate
        self.save()

    def recover(self, archive, source=None, image=None, image_ref=None, local_image=None, rebuild_source=False):
        if not self.record: raise OperationError('Recover the private hosted state and keys first; see the lost-server runbook.')
        if self.pending:
            self.docker_ready(); self.reconcile_commands()
            if self.pending.get('rehearsal'):
                from hosted_rehearsal import cleanup
                cleanup(self, self.pending['rehearsal']['id'])
            # Preserve the failed operation record; a deliberate recovery replaces the pending action only.
            write_json(self.state / ('failed-' + self.pending['id'] + '.json'), self.pending)
        release = self.record.get('active') or (self.pending or {}).get('candidate')
        if not release: raise OperationError('No previous installation was recorded. Preserve state and use the advanced recovery procedure.')
        self.pending = None
        self.begin('recover', archive=str(Path(archive).resolve()), previous=release,
                   source=str(Path(source).resolve()) if source else None, suppliedImage=image if self.test else None,
                   imageRef=image_ref, localImage=local_image, rebuildSource=rebuild_source,
                   recoveryDatabase='recovered_' + secrets.token_hex(6) + ('_test' if self.test else ''))
        self.resume()

    def resume(self, password=None):
        if not self.pending: raise OperationError('No pending operation. Use status to see the installed release.')
        if self.pending.get('format') != OPERATION_FORMAT:
            raise OperationError('Finish this pending operation with the controller that started it before upgrading controller versions.')
        self.docker_ready(); self.reconcile_commands(); kind = self.pending['kind']
        entry_completed = set(self.pending['completed'])
        if kind == 'restore-test':
            self.verify_storage()
            self.step('test-recovery', lambda: self.rehearsal(self.pending['archive']))
            self.finish(); print('Restore test passed. Live services and data were unchanged.'); return
        if 'reopen-application' in entry_completed:
            # The application is already serving. Never re-enter maintenance or replay migration.
            candidate = self.pending['candidate']
            self.verify_deployed(candidate)
            if 'verify-scheduled-backup' in entry_completed:
                self.verify_archive(Path(self.record['backupDirectory']) / self.pending['verifiedBackup']['file'], candidate)
                self.finish(); print('Application ready; recorded backup authenticated.'); return
            self.step('retry-scheduled-backups-' + str(len(self.pending['attempts'])), lambda: self.start_backups(candidate))
            self.step('verify-scheduled-backup', lambda: self.await_backup(candidate)); self.finish()
            print('Application ready; scheduled backup verified.'); return
        if kind == 'install':
            self.step('register-backup-storage', self.register_storage)
            self.step('prepare-image', self.prepare_candidate)
            self.step('generate-configuration', self.configure)
            candidate = self.pending['candidate']
            self.step('start-database', lambda: self.compose(candidate, ['up', '-d', '--wait', 'db']))
            self.step('apply-migrations', lambda: self.console(candidate, 'admin', 'scripts/migrate.ts'))
            def owner():
                state = json.loads(self.console(candidate, 'web', 'scripts/hosted-console.ts', 'inspect'))
                if not state['owner']:
                    chosen = password if password is not None else owner_password()
                    self.console(candidate, 'admin', 'scripts/owner.ts', 'bootstrap', '--password-stdin', data=chosen + '\n')
            self.step('create-owner', owner)
            self.step('enable-maintenance', lambda: self.maintenance(candidate, True))
        elif kind == 'upgrade':
            self.verify_storage()
            self.step('prepare-image', self.prepare_candidate)
            candidate, previous = self.pending['candidate'], self.pending['previous']
            self.step('validate-upgrade-source', self.validate_upgrade)
            def preparation(): self.pending['preparationBackup'] = self.backup(previous); self.checkpoint()
            self.step('prepare-rehearsal-backup', preparation)
            self.step('rehearse-candidate', lambda: self.rehearsal(Path(self.record['backupDirectory']) / self.pending['preparationBackup']['file'], candidate))
            self.step('enable-maintenance', lambda: self.maintenance(previous, True))
            self.step('drain-active-work', lambda: self.drain_work(previous))
            def snapshot(): self.pending['backup'] = self.backup(previous); self.checkpoint()
            self.step('verify-pre-upgrade-backup', snapshot)
            self.step('stop-application', lambda: self.compose(previous, ['--profile', 'backup', 'stop', 'web', 'worker', 'backup']))
            # Authenticate the recorded point again even when resuming after interruption.
            if 'verify-pre-upgrade-backup' in entry_completed:
                self.verify_archive(Path(self.record['backupDirectory']) / self.pending['backup']['file'], previous)
            self.step('apply-migrations', lambda: self.console(candidate, 'admin', 'scripts/migrate.ts'))
        elif kind == 'recover':
            self.verify_storage()
            self.step('prepare-recovery-tools', self.recovery_tools)
            previous = self.pending['tools']
            def verify_recovery():
                self.pending['archiveMetadata'] = self.verify_archive(self.pending['archive'], previous); self.checkpoint()
            self.step('verify-recovery-archive', verify_recovery)
            self.step('start-recovery-cluster', lambda: self.compose(previous, ['up', '-d', '--wait', '--no-recreate', 'db']))
            def maintenance():
                # An empty replacement VPS has no previous database/schema to pause.
                name = previous['database']
                if not re.fullmatch('[a-z][a-z0-9_]*', name): raise OperationError('Invalid recorded database name.')
                exists = self.compose(previous, ['exec', '-T', 'db', 'psql', '-U', self.database_user(), '-d', self.record['database'], '-Atc', f"select 1 from pg_database where datname='{name}'"]).stdout.strip()
                if exists:
                    table = self.compose(previous, ['exec', '-T', 'db', 'psql', '-U', self.database_user(), '-d', name, '-Atc', "select to_regclass('host.settings')"]).stdout.strip()
                    if table: self.maintenance(previous, True)
            self.step('enable-maintenance', maintenance)
            self.step('stop-application', lambda: self.compose(previous, ['--profile', 'backup', 'stop', 'web', 'worker', 'backup']))
            def database():
                name = self.pending['recoveryDatabase']
                exists = self.compose(previous, ['exec', '-T', 'db', 'psql', '-U', self.database_user(), '-d', self.record['database'], '-Atc', f"select 1 from pg_database where datname='{name}'"]).stdout.strip()
                if not exists: self.compose(previous, ['exec', '-T', 'db', 'createdb', '-U', self.database_user(), name])
            self.step('create-recovery-database', database)
            recovery_dir = private_directory(self.state / ('recovery-' + self.pending['id']))
            restored = {**previous, 'database': self.pending['recoveryDatabase']}
            def restore():
                archive = Path(self.pending['archive']); source = recovery_dir / 'matched-source'
                # A crash after restore but before the checkpoint is ambiguous: preserve that target/source.
                if source.exists(): raise OperationError('Recovery source already exists after an interrupted restore. Nothing was overwritten. Start recover again for a new database; preserve this attempt for inspection.')
                self.console(restored, 'recovery', 'scripts/restore.ts', '/selected/' + archive.name, '--confirm-replace', '--source-dir', '/recovery/matched-source',
                             extra=['-v', str(archive.parent) + ':/selected:ro', '-v', str(recovery_dir) + ':/recovery'])
            self.step('restore-snapshot', restore)
            def build_permissions():
                # Archives deliberately extract private files. Source entering a container must
                # be readable by its runtime/backup UIDs; the outer recovery directory stays 0700.
                # No .env or secret files are present in an authenticated source archive.
                source = recovery_dir / 'matched-source'
                for directory, folders, files in os.walk(source):
                    Path(directory).chmod(0o755)
                    for name in files:
                        path = Path(directory) / name
                        if path.is_symlink(): raise OperationError('Recovered build source cannot contain symlinks.')
                        path.chmod(0o644)
            self.step('prepare-source-permissions', build_permissions)
            self.step('prepare-recovered-image', lambda: self.recovered_image(recovery_dir / 'matched-source'))
            candidate = self.pending['candidate']; candidate['database'] = restored['database']; self.checkpoint()
            self.step('refresh-recovered-permissions', lambda: self.console(candidate, 'admin', 'scripts/migrate.ts'))
        else: raise OperationError('Unknown pending operation.')
        if 'verify-https-and-services' in entry_completed: self.ready(candidate)
        self.step('verify-https-and-services', lambda: self.ready(candidate))
        self.step('select-active-release', lambda: self.select_release(candidate))
        self.step('reopen-application', lambda: self.maintenance(candidate, False))
        self.step('start-scheduled-backups', lambda: self.start_backups(candidate))
        self.step('verify-scheduled-backup', lambda: self.await_backup(candidate))
        self.finish()
        print('Ready: ' + self.origin() + '\nKeep a separate protected recovery copy of this state directory, especially .env and .secrets. Remote storage verification is not a substitute for a second-machine restore rehearsal.', flush=True)


def owner_password():
    if not sys.stdin.isatty(): raise OperationError('Use a terminal to choose the owner password. It is never accepted as an argument or saved in hosted state.')
    first = getpass.getpass('Choose your Athlete Panel login password (12–256 characters): ')
    if len(first) < 12 or len(first) > 256 or first.rstrip() != first or any(ord(char) < 32 for char in first): raise OperationError('Use 12–256 characters without control characters or trailing whitespace.')
    if first != getpass.getpass('Confirm login password: '): raise OperationError('Passwords did not match. Resume to try again; generated configuration was preserved.')
    return first


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=None, help='Private persistent operator state; use the same location for all releases')
    commands = parser.add_subparsers(dest='command', required=True)
    install = commands.add_parser('install'); install.add_argument('--domain', required=True); install.add_argument('--backup-directory', required=True)
    update = commands.add_parser('upgrade'); update.add_argument('--accept-custom-changes', action='store_true', help='Acknowledge replacing a custom build/publisher or intentionally removing plugins; retained migrations remain mandatory')
    commands.add_parser('resume'); commands.add_parser('backup'); commands.add_parser('status'); commands.add_parser('cancel')
    logs = commands.add_parser('logs'); logs.add_argument('--service', choices=['web','worker','backup','caddy'], default='worker')
    verify = commands.add_parser('verify-backup'); verify.add_argument('--archive', type=Path, required=True)
    restore_test = commands.add_parser('restore-test'); restore_test.add_argument('--archive', type=Path)
    recover = commands.add_parser('recover'); recover.add_argument('--archive', type=Path, required=True); recover.add_argument('--confirm-recovery', action='store_true', required=True)
    recover.add_argument('--rebuild-source', action='store_true', help='Rebuild authenticated archived source when its matching image is unavailable')
    for command in [install, update, recover]:
        selection = command.add_mutually_exclusive_group()
        selection.add_argument('--image', help='Pull a trusted registry/repository:version or registry/repository@sha256:digest')
        selection.add_argument('--local-image', help='Use an already built/loaded custom image; never pull it')
        selection.add_argument('--source', type=Path, help='Advanced: build reviewed source including custom plugins')
    args = parser.parse_args()
    if args.state is None:
        try: args.state = default_state()
        except OperationError as error: parser.error(str(error))
    selected = {}; expected_commit = None
    if args.command in ['install', 'upgrade', 'recover']:
        if not (args.image or args.local_image or args.source) and args.command != 'recover':
            bundle = ROOT / 'release.json'
            if bundle.is_file():
                release = json.loads(bundle.read_text())
                if release.get('format') != 1 or '@sha256:' not in release.get('image', ''): parser.error('Invalid release bundle descriptor.')
                expected_commit = release.get('commit')
                if expected_commit is not None and (not isinstance(expected_commit, str) or not re.fullmatch('[a-f0-9]{40}', expected_commit)): parser.error('Invalid release commit identity.')
                args.image = release['image']
            elif args.command == 'install' and (ROOT / 'Dockerfile').is_file(): args.source = ROOT
            else: parser.error('Select --image, --local-image or --source, or run from a release bundle.')
        try:
            if args.image: image_reference(args.image)
            if args.local_image: image_reference(args.local_image, local=True)
        except OperationError as error: parser.error(str(error))
        selected = {'source': args.source, 'image_ref': args.image, 'local_image': args.local_image}
    try:
        instance = Hosted(args.state)
        instance.expected_commit = expected_commit
        if args.command == 'status':
            record = instance.record or {}
            print(json.dumps({'installed': bool(record.get('active')), 'origin': instance.origin() if record else None,
                              'release': record.get('active'), 'pending': instance.pending, 'runtime': instance.runtime_status()}, indent=2))
            return 0
        with instance.lock():
            if args.command == 'install': instance.install(domain=args.domain, backup_directory=args.backup_directory, **selected)
            elif args.command == 'upgrade': instance.upgrade(**selected, accept_custom_changes=args.accept_custom_changes)
            elif args.command == 'resume': instance.resume()
            elif args.command == 'cancel': instance.cancel()
            elif args.command == 'recover': instance.recover(args.archive, **selected, rebuild_source=args.rebuild_source)
            elif args.command == 'backup': print(json.dumps(instance.backup()))
            elif args.command == 'verify-backup': print(json.dumps(instance.verify_archive(args.archive)))
            elif args.command == 'restore-test': instance.restore_test(args.archive)
            elif args.command == 'logs':
                release = (instance.pending or {}).get('candidate') or (instance.record or {}).get('active')
                if not release: raise OperationError('No prepared release is available for logs.')
                print(instance.compose(release, ['logs', '--tail=100', args.service]).stdout)
    except (OperationError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, OperationError) else 'Hosted operation could not complete. Check Docker, private state permissions and storage. Data and recovery points were retained.', file=sys.stderr)
        print('Use status for the saved phase, then resume after correcting the problem. No automatic rollback or database deletion was attempted.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__': sys.exit(main())
