import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chartsSummarySchema } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import charts from '../../plugins/charts/server';
import { activity, chartsId, nightRecord, plannedWorkout, trainingEvent } from '../fixtures/charts';

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

it('returns the recorded duration of every chart sport', async () => {
  const sql = connection();
  const ride = { ...activity(5, '2029-01-09', 4500), sport: 'cycling' };
  await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${ride.id},1,${sql.json(ride)})`;
  const summary = await charts.operations.summary({ weekStart: '2029-01-08', weeks: 1 });
  expect(chartsSummarySchema.parse(summary)).toEqual(summary);
  expect(summary.weeks[0]!.recordedSecondsBySport).toMatchObject({
    cycling: { value: 4500, knownCount: 1, missingCount: 0 },
    running: { value: 0, knownCount: 0, missingCount: 0 },
  });
});

it('returns elevation, running climb inputs and heart rate sessions from stored activities', async () => {
  const sql = connection();
  const run = {
    ...activity(6, '2029-01-10', 3600),
    distanceMeters: 10000,
    elevationMeters: 250,
    averageHeartRateBpm: 148,
  };
  await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${run.id},1,${sql.json(run)})`;
  const summary = await charts.operations.summary({ weekStart: '2029-01-08', weeks: 1 });
  expect(chartsSummarySchema.parse(summary)).toEqual(summary);
  expect(summary.weeks[0]).toMatchObject({
    recordedElevationMetersBySport: { running: { value: 250, knownCount: 1, missingCount: 0 } },
    runningClimb: {
      sessionCount: 1,
      measuredSessionCount: 1,
      elevationMeters: 250,
      distanceMeters: 10000,
    },
  });
  expect(summary.sessions).toEqual([
    {
      id: chartsId(6),
      date: '2029-01-10',
      title: 'Synthetic run',
      sport: 'running',
      averageHeartRateBpm: 148,
      durationSeconds: 3600,
    },
  ]);
});

it('reads nights from 60 days before the period for the usual range', async () => {
  const sql = connection();
  for (const night of [
    nightRecord(7, '2028-11-09', 'hrvMilliseconds', 51),
    nightRecord(8, '2028-11-08', 'hrvMilliseconds', 54),
    nightRecord(9, '2029-01-09', 'restingHeartRateBpm', 47),
  ])
    await sql`insert into activity_records.records(kind,id,revision,data) values('health',${night.id},1,${sql.json(night)})`;
  const summary = await charts.operations.summary({ weekStart: '2029-01-08', weeks: 1 });
  expect(summary.nights.map((night) => night.date)).toEqual(['2028-11-09', '2029-01-09']);
});

it('refuses a selection longer than 53 weeks', async () => {
  await expect(charts.operations.summary({ weekStart: '2029-01-08', weeks: 54 })).rejects.toThrow();
});

it('loads the chart while a save holds the write lock', async () => {
  const sql = connection();
  const workout = plannedWorkout(1, '2029-01-09', 5400);
  await sql`insert into training.records(kind,id,revision,data) values('workout',${workout.id},1,${sql.json(workout)})`;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const summary = await Promise.race([
        charts.operations.summary({ weekStart: '2029-01-08', weeks: 1 }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The chart waited for the write lock')), 2000);
        }),
      ]);
      expect(summary.weeks[0]!.plannedSeconds.value).toBe(5400);
    } finally {
      clearTimeout(timer);
    }
  });
});
