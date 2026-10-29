#!/usr/bin/env python3
"""Transfer and publish the exact tested image. Publication is an explicit CI command."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'athlete-panel:release-check'


def command_diagnostic(args, stderr='', code=None):
    # Never print arguments, URLs or arbitrary remote output in public Actions logs.
    # Classify known failures into bounded, actionable messages instead.
    words = [str(arg) for arg in args]
    operations = [('docker', 'push'), ('docker', 'pull'), ('docker', 'load'),
                  ('docker', 'image', 'inspect'), ('gh', 'release', 'upload'),
                  ('gh', 'release', 'download'), ('gh', 'release', 'create'),
                  ('gh', 'release', 'edit'), ('gh', 'release', 'view'), ('git', 'rev-parse'),
                  ('git', 'fetch'), ('git', 'merge-base')]
    operation = next((' '.join(parts) for parts in operations if words[:len(parts)] == list(parts)), 'Release command')
    detail = (stderr.decode(errors='replace') if isinstance(stderr, bytes) else stderr or '').lower()
    reasons = [
        (r'permission denied|denied|unauthorized|forbidden|authentication|status (?:401|403)|http (?:401|403)', 'Access denied; check registry/package and release permissions.'),
        (r'rate limit|too many requests|429', 'Rate limit reached; retry after the service limit resets.'),
        (r'no space left|disk quota', 'Insufficient disk space; check runner storage.'),
        (r'timed? out|timeout|connection|network|no such host|resolve host|lookup', 'Network request failed; check connectivity and retry.'),
        (r'certificate|tls|x509', 'TLS verification failed; check certificates and service availability.'),
        (r'already exists|already_exists|422|conflict', 'Remote contents conflict; inspect existing assets before retrying.'),
        (r'not found|does not exist|404', 'Required image, tag or asset was not found.'),
    ]
    reason = next((message for pattern, message in reasons if re.search(pattern, detail)),
                  'Unclassified failure; inspect service availability and the selected artifact. Raw output withheld.')
    return f'{operation} failed' + (f' (exit {code})' if isinstance(code, int) else '') + ': ' + reason


def run(args, **kwargs):
    try:
        return subprocess.run([str(arg) for arg in args], text=True, capture_output=True, check=True, **kwargs).stdout.strip()
    except subprocess.CalledProcessError as error:
        raise ValueError(command_diagnostic(args, error.stderr, error.returncode)) from None


def checksum(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def read_metadata(image):
    container = run(['docker', 'create', image])
    try:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'metadata.json'
            run(['docker', 'cp', container + ':/app/.athlete-panel-release.json', path])
            return json.loads(path.read_text())
    finally:
        run(['docker', 'rm', container])


def inspect(image):
    return json.loads(run(['docker', 'image', 'inspect', image]))[0]


def export_image(directory, commit):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'image.tar'
    if target.exists(): raise ValueError('Existing image archive was preserved.')
    info, metadata = inspect(IMAGE), read_metadata(IMAGE)
    if info['Os'] != 'linux' or info['Architecture'] != 'amd64': raise ValueError('Release images must be Linux AMD64.')
    if metadata.get('commit') != commit: raise ValueError('Built commit differs from checkout.')
    run(['docker', 'save', '-o', target, IMAGE])
    record = {'format': 1, 'commit': commit, 'imageId': info['Id'], 'metadata': metadata, 'sha256': checksum(target)}
    (directory / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')
    return record


def verify_image(directory, commit):
    record = json.loads((directory / 'candidate.json').read_text())
    if record.get('format') != 1 or record.get('commit') != commit:
        raise ValueError('Candidate belongs to a different commit or artifact format.')
    if checksum(directory / 'image.tar') != record['sha256']: raise ValueError('Image archive checksum mismatch.')
    run(['docker', 'load', '-i', directory / 'image.tar'])
    info = inspect(IMAGE)
    if info['Id'] != record['imageId'] or info['Os'] != 'linux' or info['Architecture'] != 'amd64':
        raise ValueError('Loaded image identity/platform differs from the tested candidate.')
    if read_metadata(IMAGE) != record['metadata'] or record['metadata'].get('commit') != commit:
        raise ValueError('Loaded release metadata differs from the tested candidate.')
    return record


def remote_image(reference):
    result = subprocess.run(['docker', 'pull', reference], text=True, capture_output=True)
    if result.returncode:
        # Authentication, timeout and rate limiting are not evidence of absence.
        if any(message in result.stderr.lower() for message in ['manifest unknown', 'name unknown', 'manifest not found']): return None
        raise ValueError(command_diagnostic(['docker', 'pull'], result.stderr, result.returncode) + ' Existing image tags were not replaced.')
    return inspect(reference)


def existing_release(repository, tag):
    result = subprocess.run(['gh', 'release', 'view', tag, '--repo', repository, '--json', 'assets,isDraft,isPrerelease,targetCommitish'], capture_output=True, text=True)
    if result.returncode:
        if 'release not found' in result.stderr.lower(): return None
        raise ValueError(command_diagnostic(['gh', 'release', 'view'], result.stderr, result.returncode) + ' Existing releases were preserved.')
    return json.loads(result.stdout)


def verify_release_tag(tag, commit, version):
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', tag) or tag[1:] != version:
        raise ValueError('Release tag must match the package version.')
    if run(['git', 'rev-parse', 'refs/tags/' + tag + '^{commit}'], cwd=ROOT) != commit:
        raise ValueError('Tag no longer identifies the verified commit.')
    prerelease = '-' in tag
    if not prerelease:
        # Refresh on every attempt; a stale tracking ref is not evidence of main membership.
        # The GitHub tag ruleset is the permission boundary, not this versioned script.
        run(['git', 'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'], cwd=ROOT, timeout=60)
        command = ['git', 'merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
        if result.returncode == 1:
            raise ValueError('Stable releases must reference a commit on origin/main. Use a prerelease version to test a feature branch.')
        if result.returncode:
            raise ValueError(command_diagnostic(command, result.stderr, result.returncode))
    return prerelease


def publish(directory, commit, repository, tag, evidence_directory):
    if not re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository): raise ValueError('Invalid repository.')
    record = verify_image(directory, commit)
    prerelease = verify_release_tag(tag, commit, record['metadata']['version'])
    release_flags = ['--prerelease', '--latest=false'] if prerelease else ['--prerelease=false']
    evidence = []
    for kind in ['release', 'hosted', 'hosted-registry']:
        entry = json.loads((evidence_directory / (kind + '.json')).read_text())
        if entry.get('commit') != commit or entry.get('imageId') != record['imageId'] or entry.get('result') != 'succeeded':
            raise ValueError('Missing or mismatched successful rehearsal evidence.')
        evidence.append(entry)
    release = existing_release(repository, tag)
    if release and not release['isDraft'] and release['isPrerelease'] != prerelease:
        raise ValueError('Published release classification differs from its tag; review it explicitly. Existing release was preserved.')
    repo = 'ghcr.io/' + repository.lower()
    references = [repo + ':' + tag, repo + ':sha-' + commit]
    existing = [remote_image(ref) for ref in references]
    for info in existing:
        if info and info['Id'] != record['imageId']:
            raise ValueError('Published version/commit already points to different image contents; nothing was overwritten.')
    # Loading a remote tag may retag local names; always publish by the verified immutable ID.
    for ref, info in zip(references, existing):
        if info is None:
            run(['docker', 'tag', record['imageId'], ref]); run(['docker', 'push', ref])
    resolved = remote_image(references[0])
    digest = next(value for value in resolved['RepoDigests'] if value.startswith(repo + '@sha256:'))
    run(['docker', 'pull', digest])
    if inspect(digest)['Id'] != record['imageId'] or read_metadata(digest) != record['metadata']:
        raise ValueError('Published digest differs from the verified image; release bundle was not published.')
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder)
        spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package-release.py')
        packager = importlib.util.module_from_spec(spec); spec.loader.exec_module(packager)
        bundle = output / 'athlete-panel-deploy.tgz'
        packager.package_release(digest, bundle, commit)
        identity = {'format': 1, 'commit': commit, 'image': digest, 'imageId': record['imageId'],
                    'sourceDigest': record['metadata']['sourceDigest'], 'bundleSha256': checksum(bundle)}
        (output / 'release-record.json').write_text(json.dumps(identity, indent=2) + '\n')
        (output / 'verification.json').write_text(json.dumps({'release': identity, 'rehearsals': evidence}, indent=2) + '\n')
        names = ['athlete-panel-deploy.tgz', 'athlete-panel-deploy.tgz.sha256', 'release-record.json', 'verification.json']
        if release:
            present = {asset['name'] for asset in release['assets']}
            downloaded = output / 'existing'; downloaded.mkdir()
            for name in names:
                if name in present:
                    run(['gh', 'release', 'download', tag, '--repo', repository, '--pattern', name, '--dir', downloaded])
                    if name == 'verification.json':
                        if json.loads((downloaded / name).read_text()).get('release') != identity:
                            raise ValueError('Published verification belongs to another release.')
                    elif checksum(downloaded / name) != checksum(output / name):
                        raise ValueError('Existing release asset differs; it was preserved.')
                elif not release['isDraft']:
                    raise ValueError('Published release is missing an expected asset; repair it explicitly.')
            missing = [output / name for name in names if name not in present]
            if missing: run(['gh', 'release', 'upload', tag, '--repo', repository, *missing])
        else:
            notes = output / 'notes.txt'
            warning = 'Prerelease: test on a separate instance with its own database, storage and synthetic data.\n\n' if prerelease else ''
            notes.write_text(warning + f'Tested Linux AMD64 release.\n\nCommit: {commit}\nImage: {digest}\n\nExtract the deployment bundle and run python3 scripts/hosted.py upgrade. Preserve your private operator state and recovery keys.\n')
            run(['gh', 'release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', tag,
                 *release_flags, '--notes-file', notes, *(output / name for name in names)])
        if not release or release['isDraft']:
            run(['gh', 'release', 'edit', tag, '--repo', repository, '--draft=false', *release_flags])
    print('Published the tested image and matching deployment bundle: ' + digest)


def rehearse(kind, commit, output):
    command = [sys.executable, 'scripts/rehearse-release.py' if kind == 'release' else 'scripts/rehearse-hosted.py', '--image', IMAGE]
    if kind == 'hosted-registry': command.append('--registry')
    output.parent.mkdir(parents=True, exist_ok=True)
    phases = output.with_name(kind + '-phases.json')
    if kind != 'release': command += ['--report', str(phases)]
    started = time.monotonic()
    result = subprocess.run(command)
    output.write_text(json.dumps({'scenario': kind, 'commit': commit, 'imageId': inspect(IMAGE)['Id'],
                                 'seconds': round(time.monotonic() - started, 3),
                                 'operations': json.loads(phases.read_text()) if phases.exists() else [],
                                 'result': 'succeeded' if result.returncode == 0 else 'failed'}, indent=2) + '\n')
    if result.returncode: raise ValueError('Container rehearsal failed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['export', 'verify', 'publish', 'rehearse'])
    parser.add_argument('--directory', type=Path, default=Path('.runtime/release-candidate'))
    parser.add_argument('--commit', required=True)
    parser.add_argument('--repository'); parser.add_argument('--tag')
    parser.add_argument('--evidence-directory', type=Path, default=Path('.runtime/release-evidence'))
    parser.add_argument('--kind', choices=['release', 'hosted', 'hosted-registry'])
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.commit): parser.error('A full commit SHA is required.')
    try:
        if args.command == 'export': export_image(args.directory, args.commit)
        elif args.command == 'verify': verify_image(args.directory, args.commit)
        elif args.command == 'rehearse':
            if not args.kind: parser.error('--kind is required')
            rehearse(args.kind, args.commit, args.evidence_directory / (args.kind + '.json'))
        else:
            if not args.repository or not args.tag: parser.error('--repository and --tag are required')
            publish(args.directory, args.commit, args.repository, args.tag, args.evidence_directory)
    except ValueError as error:
        parser.exit(1, str(error) + '\nExisting release assets were preserved.\n')
    except subprocess.CalledProcessError as error:
        parser.exit(1, command_diagnostic(error.cmd, error.stderr, error.returncode) + '\nExisting release assets were preserved.\n')
    except subprocess.TimeoutExpired as error:
        parser.exit(1, command_diagnostic(error.cmd, 'timeout') + '\nExisting release assets were preserved.\n')
    except (OSError, KeyError, subprocess.SubprocessError):
        parser.exit(1, 'Release operation failed. Review candidate identity, checksums, tag/version, registry access and existing release assets. No existing release assets were overwritten.\n')


if __name__ == '__main__': main()
