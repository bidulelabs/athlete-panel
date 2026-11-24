import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { mutate, undoChange } from '../../plugins/training/service';

const url = isolatedDatabaseUrl();
const raceId = randomUUID();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.changes,host.idempotency,training.records`;
  await owner([
    {
      action: 'event.create',
      values: { id: raceId, title: 'Synthetic race', kind: 'race', date: '2027-06-20' },
    },
  ]);
});
afterAll(closeDatabase);

const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });
const raceDayFields = ['startTime', 'finishCutoff', 'stations'];
const withoutRaceDayFields = async () => {
  const sql = connection();
  await sql`update training.records set data = data - 'startTime' - 'finishCutoff' - 'stations' where kind = 'racePlan'`;
  await sql`update host.changes set changes = (select jsonb_agg(case when change->>'entity' = 'racePlan' then jsonb_set(change, '{after}', coalesce((change->'after') - 'startTime' - 'finishCutoff' - 'stations', 'null'::jsonb)) else change end) from jsonb_array_elements(changes) change)`;
};
const racePlanSnapshot = async (changeId: string) => {
  const [row] = await connection()`select changes from host.changes where id = ${changeId}`;
  return (row!.changes as { entity: string; after: object | null }[]).find(
    (change) => change.entity === 'racePlan',
  )!.after!;
};

it('undoes the creation of a race plan saved before the race-day fields existed', async () => {
  const created = await owner([
    { action: 'racePlan.create', values: { id: randomUUID(), eventId: raceId, target: 'Finish' } },
  ]);
  await withoutRaceDayFields();
  expect(Object.keys(await racePlanSnapshot(created.id))).not.toEqual(
    expect.arrayContaining(raceDayFields),
  );
  await undoChange({ id: created.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toHaveLength(0);
});

it('undoes a batch holding that race plan together with another record', async () => {
  const created = await owner([
    { action: 'racePlan.create', values: { id: randomUUID(), eventId: raceId, target: 'Finish' } },
    {
      action: 'note.create',
      values: {
        title: 'Synthetic note',
        body: '',
        schedule: { kind: 'independent', date: '2027-06-01' },
      },
    },
  ]);
  await withoutRaceDayFields();
  await undoChange({ id: created.id, idempotencyKey: randomUUID() });
  const state = await loadWorkspace();
  expect([state.racePlans.length, state.notes.length]).toEqual([0, 0]);
});

it('still refuses to undo a race plan edited since', async () => {
  const racePlanId = randomUUID();
  const created = await owner([
    { action: 'racePlan.create', values: { id: racePlanId, eventId: raceId, target: 'Finish' } },
  ]);
  await withoutRaceDayFields();
  await owner([
    {
      action: 'racePlan.update',
      id: racePlanId,
      expectedRevision: 1,
      values: { briefing: 'Mine' },
    },
  ]);
  await expect(undoChange({ id: created.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({
    code: 'undo_conflict',
  });
});
