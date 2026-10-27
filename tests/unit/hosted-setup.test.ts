import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { configureHosted, hostedValues } from '../../scripts/configure-hosted';
it('creates private independent secrets, refuses replacement and can resume after key creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athlete-panel-hosted-test-'));
  try {
    await configureHosted(root, 'training.example.com', root, 'v0.1.0');
    const original = await readFile(join(root, '.env'), 'utf8'),
      values = parseEnv(original),
      key = await readFile(join(root, '.secrets/backup-key'), 'utf8');
    expect(
      new Set([
        values.POSTGRES_PASSWORD,
        values.APP_DATABASE_PASSWORD,
        values.ENCRYPTION_KEY,
        key.trim(),
      ]).size,
    ).toBe(4);
    expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o600);
    await expect(configureHosted(root, 'training.example.com', root, 'v0.2.0')).rejects.toThrow(
      'preserved',
    );
    expect(await readFile(join(root, '.env'), 'utf8')).toBe(original);
    await rm(join(root, '.env'));
    await configureHosted(root, 'training.example.com', root, 'v0.2.0');
    expect(await readFile(join(root, '.secrets/backup-key'), 'utf8')).toBe(key);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects unsafe domains, paths and secret symlinks', async () => {
  expect(() => hostedValues('https://example.com', '/backups', 'v1')).toThrow();
  expect(() => hostedValues('example.com', '/backups/$HOME', 'v1')).toThrow();
  const root = await mkdtemp(join(tmpdir(), 'athlete-panel-hosted-test-'));
  try {
    await symlink(tmpdir(), join(root, '.secrets'));
    await expect(configureHosted(root, 'example.com', root, 'v1')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
