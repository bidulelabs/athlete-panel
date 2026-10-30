#!/usr/bin/env python3
"""Verify image recovery across real Docker stores in a disposable nested daemon.

Requires an explicitly selected local synthetic/test image and Docker-in-Docker.
Never switches or restarts the host daemon. The guest has no network, published
ports, host Docker socket or application storage. Its privileged container is
used only to run the isolated test daemon and is removed with its storage.
"""
import argparse
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time

import image_identity


def run(args, check=True):
    return subprocess.run([str(arg) for arg in args], capture_output=True, text=True, check=check, timeout=300)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--daemon-image', required=True, help='Locally available reviewed Docker-in-Docker image')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(); name = 'athlete-panel-image-store-' + secrets.token_hex(6)
    started = time.monotonic(); evidence = {'result': 'failed'}
    before = set(run(['docker', 'image', 'ls', '-q', '--no-trunc']).stdout.split())
    imported = set()
    with tempfile.TemporaryDirectory(prefix='athlete-panel-image-stores-') as folder:
        directory = Path(folder)
        config = directory / 'daemon.json'
        config.write_text(json.dumps({'features': {'containerd-snapshotter': False}, 'storage-driver': 'overlay2',
                                      'iptables': False, 'bridge': 'none', 'hosts': ['unix:///var/run/docker.sock']}))
        try:
            run(['docker', 'image', 'inspect', args.daemon_image])  # Never implicitly pull/run a different daemon.
            run(['docker', 'run', '-d', '--name', name, '--privileged', '--network', 'none', '--entrypoint', 'dockerd',
                 '--mount', 'type=bind,source=' + str(config) + ',target=/etc/docker/daemon.json,readonly', args.daemon_image])
            def guest(command, check=True): return run(['docker', 'exec', name, 'docker', *command[1:]], check)
            for _ in range(30):
                if guest(['docker', 'info'], False).returncode == 0: break
                time.sleep(1)
            else: raise ValueError('Disposable classic Docker daemon did not become ready.')
            host_info = json.loads(run(['docker', 'info', '--format', '{{json .}}']).stdout)
            guest_info = json.loads(guest(['docker', 'info', '--format', '{{json .}}']).stdout)
            if guest_info['Driver'] != 'overlay2': raise ValueError('Guest is not using the classic image store.')
            original = json.loads(run(['docker', 'image', 'inspect', args.image]).stdout)[0]
            archive = directory / 'original.tar'
            run(['docker', 'save', '-o', archive, original['Id']])
            original_identity = image_identity.identify(original['Id'], run, archive=archive)
            run(['docker', 'cp', archive, name + ':/tmp/original.tar'])
            loaded = guest(['docker', 'load', '-i', '/tmp/original.tar']).stdout
            references = re.findall(r'Loaded image(?: ID)?: ([^\n]+)', loaded)
            if len(references) != 1: raise ValueError('Expected one loaded image.')
            classic = json.loads(guest(['docker', 'image', 'inspect', references[0]]).stdout)[0]
            classic_identity = image_identity.identify(classic['Id'], guest, archive=archive)
            image_identity.verify(classic_identity, original_identity)
            image_identity.verify(classic_identity, None, original['Id'])  # Legacy containerd record.
            if classic['Id'] != original_identity['configDigest']: raise ValueError('Classic engine did not report the configuration ID.')
            guest(['docker', 'save', '-o', '/tmp/classic.tar', classic['Id']])
            exported = directory / 'classic.tar'; run(['docker', 'cp', name + ':/tmp/classic.tar', exported])
            image_identity.verify(image_identity.archive_identity(exported, classic),
                                  {key: value for key, value in original_identity.items() if key not in {'manifestDigest', 'indexDigest'}})
            loaded = run(['docker', 'load', '-i', exported]).stdout
            for reference in re.findall(r'Loaded image(?: ID)?: ([^\n]+)', loaded):
                actual = json.loads(run(['docker', 'image', 'inspect', reference]).stdout)[0]
                imported.add(actual['Id'])
                identity = image_identity.identify(actual['Id'], run, archive=exported)
                image_identity.verify(identity, None, classic['Id'])  # Legacy classic record on containerd.
                if not image_identity.same_content(identity, original_identity): raise ValueError('Round-trip image content differs.')
            evidence.update(result='succeeded', hostDriver=host_info['Driver'], hostDriverStatus=host_info.get('DriverStatus'),
                            guestDriver=guest_info['Driver'], guestVersion=guest_info['ServerVersion'],
                            hostLocalId=original['Id'], classicLocalId=classic['Id'], identity=original_identity,
                            daemonImage=json.loads(run(['docker', 'image', 'inspect', args.daemon_image]).stdout)[0]['Id'])
        finally:
            run(['docker', 'rm', '-fv', name], False)
            for identifier in imported - before: run(['docker', 'image', 'rm', identifier], False)
            evidence['seconds'] = round(time.monotonic() - started, 3)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(evidence, indent=2) + '\n')
    print('PASS: real classic/containerd image transfer and legacy identity verification.')


if __name__ == '__main__': main()
