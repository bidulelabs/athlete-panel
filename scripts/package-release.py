#!/usr/bin/env python3
"""Create a small digest-pinned deployment bundle locally. Never builds or publishes images."""
import argparse
import hashlib
import io
import gzip
import json
import re
from pathlib import Path
import tarfile
from hosted import image_reference, ROOT, OperationError


def package_release(image, output, commit=None):
    image_reference(image)
    if '@sha256:' not in image: raise ValueError('Release bundles require an immutable registry digest, not a tag.')
    if commit is not None and not re.fullmatch('[a-f0-9]{40}', commit): raise ValueError('Use the full Git commit SHA.')
    output = Path(output)
    checksum = output.with_name(output.name + '.sha256')
    if output.exists() or checksum.exists(): raise ValueError('Choose a new output filename; existing bundles are preserved.')
    contents = {
        'scripts/hosted.py': (ROOT / 'scripts/hosted.py').read_bytes(),
        'scripts/hosted_rehearsal.py': (ROOT / 'scripts/hosted_rehearsal.py').read_bytes(),
        'release.json': (json.dumps({'format': 1, 'image': image, **({'commit': commit} if commit else {})}, indent=2) + '\n').encode(),
        'README.txt': b'''Athlete Panel deployment bundle
Requires Linux, Docker Compose v2 and Python 3.10+. No host Node/pnpm or source build.
Use only a bundle/image from a publisher you trust. Nothing here provisions DNS or remote storage.

Fresh installation (configure DNS and mount dedicated off-host storage first):
  python3 scripts/hosted.py install --domain training.example.com --backup-directory /mnt/offsite/athlete-panel
Upgrade an existing managed installation from the new bundle directory:
  python3 scripts/hosted.py upgrade
Inspect/resume an interrupted operation:
  python3 scripts/hosted.py status
  python3 scripts/hosted.py resume
Create an additional verified backup:
  python3 scripts/hosted.py backup
Test a completed backup without changing live services:
  python3 scripts/hosted.py restore-test
Recover a selected snapshot into a NEW database (later changes are absent):
  python3 scripts/hosted.py recover --archive /mnt/offsite/athlete-panel/recorded.fgr --confirm-recovery

Keep ~/.local/share/athlete-panel/hosted private and persistent across releases.
Keep .env, .secrets/backup-key, .secrets/backup-storage.json and installation.json
in a separately protected recovery kit. Archives cannot replace missing keys.
Use the same --state PATH before each subcommand if using a custom state location.
Do not run fresh installation over an older manual/local installation.
Do not replace custom plugins with a stock image without reviewing compatibility.
See scripts/hosted.py --help and the release's development/operations guide for advanced recovery.
''',
    }
    # Explicit allowlist: never collect checkout .env, exports, plugins or application source.
    with output.open('xb') as destination:
        with gzip.GzipFile(fileobj=destination, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for name, data in contents.items():
                    info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644; info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))
    with checksum.open('x') as destination:
        destination.write(hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + output.name + '\n')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True); parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit')
    args = parser.parse_args()
    try:
        package_release(args.image, args.output, args.commit)
        print('Deployment bundle and checksum created locally. Nothing was published.')
    except (OSError, ValueError, OperationError) as error:
        parser.exit(1, str(error) + '\n')
