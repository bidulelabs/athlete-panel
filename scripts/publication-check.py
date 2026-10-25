#!/usr/bin/env python3
"""Inspect exact Git index/ref bytes, or current non-ignored candidates. No uploads."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL)


def findings(path, body):
    parts = Path(path).parts
    name = Path(path).name
    if (any(p in {'.secrets', 'private-exports', '.runtime', 'backups', 'node_modules', '.next'} for p in parts)
            or name in {'context.json', 'proposal.json'}
            or (name.startswith('.env') and name != '.env.example')
            or Path(path).suffix in {'.dump', '.fgr', '.pem', '.key', '.sqlite', '.db'}):
        yield 0, 'private-or-generated-file'
    text = body.decode('utf-8', errors='replace')
    rules = {
        'personal-home-path': r'/(?:Users|home)/[A-Za-z0-9_.-]+/',
        'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
        'aws-access-key': r'\bAKIA[A-Z0-9]{16}\b',
    }
    for rule, pattern in rules.items():
        for match in re.finditer(pattern, text):
            yield text.count('\n', 0, match.start()) + 1, rule


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--staged', action='store_true')
    group.add_argument('--ref')
    group.add_argument('--worktree', action='store_true')
    parser.add_argument('--inventory', help='Write path/hash inventory to an ignored local file')
    args = parser.parse_args()
    if args.ref:
        revision = git('rev-parse', '--verify', args.ref + '^{commit}').decode().strip()
        paths = git('ls-tree', '-r', '--name-only', '-z', revision).split(b'\0')
        read = lambda p: git('show', revision + ':' + p)
    elif args.staged:
        revision = 'index'
        paths = git('ls-files', '-z').split(b'\0')
        read = lambda p: git('show', ':' + p)
    else:
        revision = 'working candidates (not a release commit)'
        paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0')
        read = lambda p: Path(p).read_bytes()
    inventory, errors, media = [], [], []
    for raw in sorted(set(filter(None, paths))):
        path = raw.decode('utf-8')
        try:
            body = read(path)
        except (OSError, subprocess.CalledProcessError):
            errors.append((path, 0, 'unreadable-file'))
            continue
        inventory.append({'path': path, 'sha256': hashlib.sha256(body).hexdigest()})
        errors.extend((path, line, rule) for line, rule in findings(path, body))
        if Path(path).suffix.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.pdf', '.mp4'}:
            media.append(path)
    if args.inventory:
        out = Path(args.inventory)
        if '.runtime' not in out.parts:
            parser.error('Inventories must be kept under .runtime/')
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({'source': revision, 'files': inventory, 'manualMediaReview': media}, indent=2))
    for path, line, rule in errors:
        print(f'{path}:{line}: {rule} (value withheld)')
    print(f'Inspected {len(inventory)} exact files from {revision}; {len(errors)} findings; {len(media)} media files need visual privacy/rights review.')
    print('Also run Gitleaks against Git history. Pattern scans cannot prove absence of private data.')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
