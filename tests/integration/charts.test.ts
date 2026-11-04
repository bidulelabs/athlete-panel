import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import charts from '../../plugins/charts/server';
import { activity, chartsId, plannedWorkout, trainingEvent } from '../fixtures/charts';

beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate training.records,activity_records.records`;
});
afterAll(closeDatabase);

it('reads 52 weeks, beyond the 121-day workspace limit, without changing stored records', async () => {
  const sql = connection();
  const records = [
    ['training', 'workout', plannedWorkout(1, '2029-01-09', 5400)],
    ['training', 'event', trainingEvent(2, '2029-01-12', 'Winter trail')],
    ['activity_records', 'activity', activity(3, '2029-01-09', 4500)],
    ['activity_records', 'activity', activity(4, '2029-12-25', 3600)],
  ] as const;
  for (const [schema, kind, record] of records)
    await sql`insert into ${sql(schema + '.records')}(kind,id,revision,data) values(${kind},${record.id},1,${sql.json(record)})`;
  const before = await sql`select id,revision,data from activity_records.records order by id`;
  const summary = await charts.operations.summary({ weekStart: '2029-01-08', weeks: 52 });
  expect(summary.weeks).toHaveLength(52);
  expect(summary.weeks[0]).toMatchObject({
    weekStart: '2029-01-08',
    plannedSeconds: { value: 5400, knownCount: 1, missingCount: 0 },
    recordedSeconds: { value: 4500, knownCount: 1, missingCount: 0 },
  });
  expect(summary.weeks[51]).toMatchObject({
    weekStart: '2029-12-31',
    recordedSeconds: { value: 0, knownCount: 0, missingCount: 0 },
  });
  expect(summary.weeks[50]!.recordedSeconds.value).toBe(3600);
  expect(summary.races).toEqual([{ id: chartsId(2), date: '2029-01-12', title: 'Winter trail' }]);
  expect(await sql`select id,revision,data from activity_records.records order by id`).toEqual(
    before,
  );
});

it('refuses a selection longer than 53 weeks', async () => {
  await expect(charts.operations.summary({ weekStart: '2029-01-08', weeks: 54 })).rejects.toThrow();
});
