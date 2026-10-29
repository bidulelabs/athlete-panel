import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupHeartbeat } from '../../scripts/lib/backup-heartbeat';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function secret(settings: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-heartbeat-test-'));
  directories.push(directory);
  const path = join(directory, 'heartbeat.json');
  await writeFile(path, JSON.stringify(settings), { mode: 0o600 });
  return path;
}

it('only sends the selected signal, with redirects blocked and bounded retries', async () => {
  const path = await secret({
    success: 'https://monitor.invalid/private-success',
    failure: 'https://monitor.invalid/private-failure',
  });
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(Error('secret remote diagnostic'))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(backupHeartbeat('failure', path, request)).resolves.toBe('sent');
  expect(request).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenCalledWith(
    'https://monitor.invalid/private-failure',
    expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) }),
  );
});

it('reports delivery failure without exposing its URL or remote errors', async () => {
  const path = await secret({ success: 'https://monitor.invalid/private-success' });
  const request = vi.fn<typeof fetch>().mockRejectedValue(Error('private endpoint'));
  await expect(backupHeartbeat('success', path, request)).resolves.toBe('failed');
  expect(request).toHaveBeenCalledTimes(3);
  request.mockClear();
  await expect(backupHeartbeat('failure', path, request)).resolves.toBe('unconfigured');
  expect(request).not.toHaveBeenCalled();
});

it('refuses public secret files, symlinks, insecure endpoints and credentials', async () => {
  const request = vi.fn<typeof fetch>();
  for (const success of [
    'http://monitor.invalid/private',
    'https://user:password@monitor.invalid',
    'https://monitor.invalid/#private',
  ]) {
    await expect(backupHeartbeat('success', await secret({ success }), request)).resolves.toBe(
      'failed',
    );
  }
  const path = await secret({ success: 'https://monitor.invalid/private' });
  await chmod(path, 0o644);
  await expect(backupHeartbeat('success', path, request)).resolves.toBe('failed');
  await chmod(path, 0o600);
  await symlink(path, path + '.link');
  await expect(backupHeartbeat('success', path + '.link', request)).resolves.toBe('failed');
  expect(request).not.toHaveBeenCalled();
});
