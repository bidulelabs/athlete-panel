import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { storageMount, verifyStorage } from '../../scripts/lib/backup-storage';
const original = { database: process.env.DATABASE_URL, origin: process.env.APP_ORIGIN };
afterEach(() => {
  if (original.database === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original.database;
  if (original.origin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = original.origin;
});
it('identifies the enclosing network mount, escaped paths and a missing-mount local fallback', () => {
  const mounts =
    '1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 0:40 / /mnt/off\\040host rw - nfs4 storage.example:/backups rw';
  expect(storageMount('/mnt/off host/athlete-panel', mounts)).toMatchObject({
    filesystem: 'nfs4',
    remote: true,
    source: 'storage.example:/backups',
  });
  expect(storageMount('/mnt/off host/athlete-panel', mounts.split('\n')[0])).toMatchObject({
    remote: false,
  });
});
it('fails closed for a missing/changed marker and forbids synthetic storage on real instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athlete-panel-storage-test-')),
    id = randomUUID(),
    policy = join(root, 'policy.json');
  try {
    await writeFile(
      policy,
      JSON.stringify({ version: 1, id, mountFingerprint: '0'.repeat(64), testOnly: true }),
    );
    process.env.DATABASE_URL = 'postgres://synthetic:synthetic@db/athlete_panel_test';
    process.env.APP_ORIGIN = 'https://localhost:4443';
    await expect(verifyStorage(root, policy)).rejects.toThrow();
    await writeFile(join(root, '.athlete-panel-storage-id'), id);
    await expect(verifyStorage(root, policy)).resolves.toBe('isolated-test');
    process.env.APP_ORIGIN = 'https://training.example.com';
    await expect(verifyStorage(root, policy)).rejects.toThrow('forbidden');
    await writeFile(join(root, '.athlete-panel-storage-id'), randomUUID());
    await expect(verifyStorage(root, policy)).rejects.toThrow('identity');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('verifies explicit local storage without a mount policy and rejects unsafe directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athlete-panel-local-storage-'));
  try {
    await expect(verifyStorage(root, '', 'local')).resolves.toBe('local');
    // Legacy unregistered backups remain readable, but gain no remote protection claim.
    await expect(verifyStorage(root, '', '')).resolves.toBe('unverified');
    await expect(verifyStorage(root, 'missing-remote-policy', 'local')).rejects.toThrow(
      'conflicts',
    );
    await symlink(root, root + '-link');
    await expect(verifyStorage(root + '-link', '', 'local')).rejects.toThrow('owner-only');
    await chmod(root, 0o755);
    await expect(verifyStorage(root, '', 'local')).rejects.toThrow('owner-only');
    await expect(verifyStorage(join(root, 'missing'), '', 'local')).rejects.toThrow();
    await expect(verifyStorage(root, '', 'typo')).rejects.toThrow('Invalid');
  } finally {
    await rm(root + '-link', { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

it('never treats absent remote policy or an ordinary local mount as remote protection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athlete-panel-remote-storage-'));
  const id = randomUUID(),
    policy = join(root, 'policy.json');
  try {
    await expect(verifyStorage(root, '', 'remote')).rejects.toThrow('requires');
    await expect(verifyStorage(root, policy, 'remote')).rejects.toThrow();
    await writeFile(policy, JSON.stringify({ version: 1, id, mountFingerprint: '0'.repeat(64) }));
    await writeFile(join(root, '.athlete-panel-storage-id'), id);
    // A valid legacy policy and marker do not make a local filesystem remote.
    await expect(verifyStorage(root, policy, 'remote')).rejects.toThrow();
    await expect(verifyStorage(root, policy, '')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
