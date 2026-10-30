"""Content identity independent of Docker's classic/containerd local ID.

Docker save is the local evidence source; registry descriptors bind its config
digest (including ordered rootfs diff IDs) to a pinned platform manifest/index.
No image is run, retagged or pulled by this module.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile

class ImageIdentityError(ValueError):
    pass


class ImagePrerequisiteError(ImageIdentityError):
    """Verification could not run; do not misreport this as mismatched content."""
    pass


DIGEST = re.compile(r'^sha256:[a-f0-9]{64}$')


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def file_checksum(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''): value.update(chunk)
    return value.hexdigest()


def output(run, args):
    result = run(args)
    return result if isinstance(result, str) else result.stdout


def require_buildx(run):
    try:
        result = run(['docker', 'buildx', 'version'])
        if getattr(result, 'returncode', 0): raise ImageIdentityError('Unavailable')
    except Exception:
        raise ImagePrerequisiteError('Docker Buildx is required for registry image verification or source builds. '
                                 'Install the Docker Buildx plugin for this Docker CLI, then retry or resume. '
                                 'Private command output was withheld.') from None


def image_scratch(info, mount_info=None):
    """Image exports belong on disk, independently of TMPDIR's usual RAM filesystem."""
    directory = Path(os.environ.get('ATHLETE_PANEL_IMAGE_TMPDIR', '/var/tmp')).expanduser()
    if not directory.is_absolute() or not directory.is_dir():
        raise ImagePrerequisiteError('Set ATHLETE_PANEL_IMAGE_TMPDIR to an existing absolute disk-backed directory for image verification.')
    directory = directory.resolve()
    if mount_info is None and Path('/proc/self/mountinfo').exists():
        mount_info = Path('/proc/self/mountinfo').read_text()
    if mount_info is not None:
        mounts = []
        for line in mount_info.splitlines():
            left, separator, right = line.partition(' - ')
            if not separator: continue
            fields = left.split()
            if len(fields) < 5 or not right.split(): continue
            mount = re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), fields[4])
            if str(directory) == mount or str(directory).startswith(mount.rstrip('/') + '/'):
                mounts.append((len(mount), right.split()[0]))
        if not mounts or max(mounts)[1] in {'tmpfs', 'ramfs'}:
            raise ImagePrerequisiteError('Image verification needs disk-backed temporary storage; the selected directory is memory-backed or unrecognized. '
                                     'Set ATHLETE_PANEL_IMAGE_TMPDIR to a directory on the server disk.')
    # Docker Size is a lower bound; allow tar/descriptor overhead, and still handle
    # export failure if concurrent writers or extra platform layers consume space.
    required = max(0, int(info.get('Size', 0))) + 64 * 1024 * 1024
    if shutil.disk_usage(directory).free < required:
        raise ImagePrerequisiteError('Insufficient disk space for image verification (at least ' + str((required + 1048575) // 1048576) +
                                 ' MiB required). Free disk space or set ATHLETE_PANEL_IMAGE_TMPDIR to a larger disk-backed directory, then retry or resume.')
    return directory


def archive_identity(path, info):
    """Read bounded regular members only; never extract an untrusted image tar."""
    with tarfile.open(path) as archive:
        def read(name):
            member = archive.getmember(name)
            if not member.isfile() or member.size > 4 * 1024 * 1024:
                raise ImageIdentityError('Invalid image configuration archive member.')
            return archive.extractfile(member).read()
        entries = json.loads(read('manifest.json'))
        matches = {}
        for entry in entries:
            raw = read(entry['Config']); config = json.loads(raw)
            if (config.get('os'), config.get('architecture'), config.get('variant', '')) != (
                    info['Os'], info['Architecture'], info.get('Variant', '')):
                continue
            if config.get('rootfs', {}).get('diff_ids', []) != info.get('RootFS', {}).get('Layers', []):
                continue
            matches[digest(raw)] = config
        if len(matches) != 1:
            raise ImageIdentityError('Saved image does not uniquely match the inspected platform/rootfs.')
        result = {'format': 1, 'os': info['Os'], 'architecture': info['Architecture'],
                  'variant': info.get('Variant', ''), 'configDigest': next(iter(matches))}
        # Containerd's save also retains OCI descriptor blobs. Authenticate those
        # relationships, including when this archive is loaded into a classic store.
        try: roots = json.loads(read('index.json'))['manifests']
        except KeyError: return result
        found = []
        def visit(descriptor, indexes=(), depth=0):
            if depth > 4: raise ImageIdentityError('Image index nesting exceeds the supported bound.')
            identifier = descriptor['digest']
            if not DIGEST.fullmatch(identifier): raise ImageIdentityError('Invalid archived descriptor.')
            raw = read('blobs/sha256/' + identifier[7:])
            if digest(raw) != identifier: raise ImageIdentityError('Archived descriptor digest mismatch.')
            value = json.loads(raw)
            if 'manifests' in value:
                for child in value['manifests']:
                    platform = child.get('platform')
                    if platform and any(platform.get(key, '') != result[key] for key in ['os', 'architecture', 'variant']): continue
                    visit(child, indexes + (identifier,), depth + 1)
            elif value.get('config', {}).get('digest') == result['configDigest']:
                found.append({'manifestDigest': identifier, **({'indexDigest': indexes[0]} if indexes else {})})
        for root in roots: visit(root)
        if len(found) != 1: raise ImageIdentityError('Archived index has no unique matching configuration.')
        result.update(found[0])
        return result


def registry_identity(reference, identity, run):
    if '@sha256:' not in reference:
        raise ImageIdentityError('Registry identity requires a pinned digest.')
    require_buildx(run)
    repository, selected = reference.split('@', 1)
    def manifest(identifier):
        if not DIGEST.fullmatch(identifier): raise ImageIdentityError('Invalid registry descriptor digest.')
        raw = output(run, ['docker', 'buildx', 'imagetools', 'inspect', repository + '@' + identifier, '--raw']).encode()
        # Docker's CLI adds a presentation newline; tolerate only that exact change.
        if digest(raw) != identifier:
            raw = raw[:-1] if raw.endswith(b'\n') else raw + b'\n'
        if digest(raw) != identifier: raise ImageIdentityError('Registry manifest digest verification failed.')
        value = json.loads(raw)
        if value.get('schemaVersion') != 2: raise ImageIdentityError('Unsupported registry manifest schema.')
        return value
    value = manifest(selected)
    result = dict(identity)
    if 'manifests' in value:
        choices = [item for item in value['manifests'] if all(
            item.get('platform', {}).get(key, '') == identity.get(key, '') for key in ['os', 'architecture', 'variant'])]
        if len(choices) != 1: raise ImageIdentityError('Image index has no unique matching platform.')
        result['indexDigest'] = selected
        selected = choices[0]['digest']; value = manifest(selected)
    if value.get('config', {}).get('digest') != identity['configDigest']:
        raise ImageIdentityError('Registry manifest configuration differs from the local tested image.')
    if 'layers' not in value or 'manifests' in value:
        raise ImageIdentityError('Unsupported platform image manifest.')
    result['manifestDigest'] = selected
    return result


def identify(image, run, registry_ref=None, archive=None):
    info = json.loads(output(run, ['docker', 'image', 'inspect', image]))[0]
    if not DIGEST.fullmatch(info['Id']) or info.get('Os') != 'linux':
        raise ImageIdentityError('A Linux image with an immutable Docker identifier is required.')
    if archive is not None:
        identity = archive_identity(archive, info)
    else:
        with tempfile.TemporaryDirectory(prefix='athlete-panel-image-', dir=image_scratch(info)) as folder:
            target = Path(folder) / 'image.tar'
            try:
                output(run, ['docker', 'save', '-o', str(target), info['Id']])
            except Exception:
                raise ImagePrerequisiteError('Image export for verification failed. Check Docker access and free disk space in '
                                         'ATHLETE_PANEL_IMAGE_TMPDIR (default /var/tmp), then retry or resume. '
                                         'The private temporary export was removed; private command output was withheld.') from None
            identity = archive_identity(target, info)
    if registry_ref: identity = registry_identity(registry_ref, identity, run)
    return identity


def verify(actual, expected, legacy_id=None):
    if expected:
        if expected.get('format') != 1: raise ImageIdentityError('Unsupported portable image identity format.')
        if expected.get('os') != 'linux' or not isinstance(expected.get('architecture'), str) or not expected['architecture'] or not isinstance(expected.get('variant'), str) or not DIGEST.fullmatch(expected.get('configDigest', '')):
            raise ImageIdentityError('Incomplete portable image identity.')
        for key in ['manifestDigest', 'indexDigest']:
            if key in expected and not DIGEST.fullmatch(expected[key]): raise ImageIdentityError('Invalid portable descriptor digest.')
        for key in ['os', 'architecture', 'variant', 'configDigest', 'manifestDigest', 'indexDigest']:
            if key in expected and actual.get(key) != expected[key]:
                raise ImageIdentityError('Image identity mismatch: ' + key + '.')
    elif legacy_id:
        # Old imageId has no declared semantics. Accept only a proven descriptor
        # relationship; never infer that it is necessarily a configuration hash.
        if legacy_id not in {actual.get(key) for key in ['configDigest', 'manifestDigest', 'indexDigest']}:
            raise ImageIdentityError('Legacy Docker identifier cannot be linked to this image. Restore its original image or explicitly rebuild authenticated source.')


def same_content(left, right):
    return all(left.get(key, '') == right.get(key, '') for key in ['os', 'architecture', 'variant', 'configDigest'])
