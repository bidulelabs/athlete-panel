#!/usr/bin/env python3
"""Create synthetic packaging probes or inspect them in a locally built image."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / 'tests/fixtures/packaging.json').read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'verify'])
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--image')
    args = parser.parse_args()
    if args.action == 'create':
        for name in FIXTURES['excluded'] + FIXTURES['included']:
            path = args.root / name
            if path.exists(): raise RuntimeError('Packaging fixture collision: ' + name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic-packaging-fixture-only\n')
    else:
        if not args.image: parser.error('verify requires --image')
        script = """const fs=require('node:fs'), f=JSON.parse(process.argv[1]);
for(const p of f.excluded) if(fs.existsSync('/app/'+p)) throw Error('Private file included: '+p);
for(const p of [...f.included,...f.required]) if(!fs.existsSync('/app/'+p)) throw Error('Required file missing: '+p);
console.log('Synthetic private files excluded; required source retained.');"""
        subprocess.run(['docker', 'run', '--rm', args.image, 'node', '-e', script, json.dumps(FIXTURES)], check=True)


if __name__ == '__main__':
    main()
