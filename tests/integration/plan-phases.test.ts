import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { readWorkspaceResponse } from '../../instance/workspace-response';
import { mutate } from '../../plugins/training/service';

const url = isolatedDatabaseUrl();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.changes,host.idempotency,athlete.records,training.records`;
});
afterAll(closeDatabase);

const target = { firstWeek: { min: 32400, max: 36000 }, lastWeek: { min: 50400, max: 54000 } };

it('stores a phase and returns it in every workspace range', async () => {
  const id = randomUUID();
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'period.create',
        values: {
          id,
          name: 'Base',
          role: 'base',
          startDate: '2026-11-02',
          endDate: '2027-01-03',
          focus: 'Threshold on flat',
          weeklyDurationSeconds: target,
        },
      },
    ],
  });
  const rows = await connection()`select kind from training.records where id=${id}`;
  expect(rows).toEqual([{ kind: 'period' }]);
  const later = await readWorkspaceResponse({ from: '2027-03-01', to: '2027-03-31' });
  expect(later.state.periods).toMatchObject([
    { id, focus: 'Threshold on flat', weeklyDurationSeconds: target },
  ]);

  await mutate({
    idempotencyKey: randomUUID(),
    commands: [{ action: 'period.delete', id, expectedRevision: 1 }],
  });
  const after = await readWorkspaceResponse({ from: '2026-11-01', to: '2026-11-30' });
  expect(after.state.periods).toEqual([]);
});
