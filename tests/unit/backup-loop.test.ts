import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backup: vi.fn(),
  heartbeat: vi.fn(),
  sql: Object.assign(vi.fn().mockResolvedValue([]), { json: (value: unknown) => value }),
}));
vi.mock('../../scripts/backup', () => ({ createBackup: mocks.backup }));
vi.mock('../../scripts/lib/backup-heartbeat', () => ({ backupHeartbeat: mocks.heartbeat }));
vi.mock('../../packages/host/src/db', () => ({
  connection: () => mocks.sql,
  closeDatabase: vi.fn(),
}));
import { backupLoop } from '../../scripts/operations';

beforeEach(() => {
  vi.stubEnv('BACKUP_DESTINATION', '/synthetic-backups');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('cleans up an aborted backup without sending a failure notification', async () => {
  const controller = new AbortController();
  mocks.backup.mockImplementationOnce(async () => {
    controller.abort();
    throw new Error('cancelled');
  });
  await backupLoop(controller.signal);
  expect(mocks.heartbeat).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ event: 'backup_cancelled' }));
});

it.each(['backup failure', 'retention failure', 'success'])(
  'reports %s while the scheduler is active',
  async (outcome) => {
    const controller = new AbortController();
    if (outcome === 'backup failure')
      mocks.backup.mockRejectedValueOnce(new Error('synthetic storage failure'));
    else
      mocks.backup.mockResolvedValueOnce({
        metadata: { createdAt: '2026-10-29' },
        retention: outcome === 'retention failure' ? 'failed' : 'succeeded',
      });
    mocks.heartbeat.mockImplementationOnce(async () => {
      controller.abort();
      return 'sent';
    });
    await backupLoop(controller.signal);
    expect(mocks.heartbeat).toHaveBeenCalledExactlyOnceWith(
      outcome === 'success' ? 'success' : 'failure',
    );
  },
);
