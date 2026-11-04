import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import { connection, closeDatabase, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { createGrant, revokeGrant } from '../../plugins/agent-bridge/service';
import { readHistory } from '../../plugins/agent-bridge/history';
import { persistCoverage } from '../../plugins/garmin/coverage';
import type { SyncCoverage } from '../../plugins/garmin/sync';
import * as sources from '../../instance/history-services';
import { syntheticDay } from '../fixtures/historical';

beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDatabase);

const owners = ['activity_records', 'training', 'athlete'] as const;
type Owner = (typeof owners)[number] | 'garmin';
const version = async (owner: Owner) =>
  Number((await connection().unsafe(`select revision from ${owner}.history_version`))[0]!.revision);
const coverage: SyncCoverage = {
  stream: 'activities',
  phase: 'recent-activities',
  from: '2024-01-01',
  to: '2024-01-07',
  status: 'complete',
  scanState: 'scanned',
  returnedRecords: 3,
  missingDays: 0,
  unknownMetrics: 0,
  oldestReturnedDate: null,
  rejectedRecords: 0,
  diagnostics: [],
};
const saveCoverage = (value = coverage) => transaction((tx) => persistCoverage(tx, value));
const nextPage = (page: Awaited<ReturnType<typeof readHistory>>) => ({
  ...page.query,
  reviewToken: page.reviewToken,
  cursor: page.nextCursor!,
});
async function access() {
  for (const record of syntheticDay('2024-01-02', 0).activities)
    await connection()`insert into activity_records.records(kind,id,revision,data) values('activity',${record.id},1,${connection().json(record)})`;
  await saveCoverage();
  await saveCoverage({ ...coverage, from: '2024-02-01', to: '2024-02-07' });
  return createGrant({
    label: 'Synthetic stable history',
    version: 2,
    planning: null,
    history: { from: '2024-01-01', to: '2024-02-29', categories: ['activities'], weekStartsOn: 1 },
  });
}

it.each(owners)(
  '%s versions ignore empty statements, identical writes and operational timestamps',
  async (owner) => {
    const sql = connection(),
      table = `${owner}.records`,
      before = await version(owner);
    await sql.unsafe(
      `insert into ${table}(kind,id,revision,data) select 'fixture','unused',1,'{}'::jsonb where false`,
    );
    await sql.unsafe(`update ${table} set revision=revision where false`);
    await sql.unsafe(`delete from ${table} where false`);
    await sql.unsafe(`truncate ${table}`);
    expect(await version(owner)).toBe(before);
    await sql.unsafe(
      `insert into ${table}(kind,id,revision,data) values('fixture','one',1,'{"value":1}'::jsonb)`,
    );
    expect(await version(owner)).toBe(before + 1);
    await sql.unsafe(
      `insert into ${table}(kind,id,revision,data) values('fixture','one',1,'{"value":1}'::jsonb) on conflict(kind,id) do nothing`,
    );
    await sql.unsafe(
      `insert into ${table}(kind,id,revision,data) values('fixture','one',1,'{"value":1}'::jsonb) on conflict(kind,id) do update set data=excluded.data`,
    );
    await sql.unsafe(`update ${table} set data=data,updated_at=updated_at+interval '1 second'`);
    expect(await version(owner)).toBe(before + 1);
    await expect(
      transaction(async (tx) => {
        await tx.unsafe(`update ${table} set revision=revision+1`);
        throw new Error('Synthetic rollback');
      }),
    ).rejects.toThrow('Synthetic rollback');
    expect(await version(owner)).toBe(before + 1);
    await sql.unsafe(`update ${table} set data='{"value":2}'::jsonb`);
    await sql.unsafe(`update ${table} set deleted=true`);
    await sql.unsafe(`update ${table} set revision=revision+1`);
    expect(await version(owner)).toBe(before + 4);
    await sql.unsafe(`delete from ${table}`);
    expect(await version(owner)).toBe(before + 5);
    await sql.unsafe(
      `insert into ${table}(kind,id,revision,data) values('fixture','two',1,'{}'::jsonb)`,
    );
    await sql.unsafe(`truncate ${table}`);
    expect(await version(owner)).toBe(before + 7);
    await sql.unsafe(`truncate ${table}`);
    expect(await version(owner)).toBe(before + 7);
  },
);

it('advances once for a real bulk statement and leaves all no-op row updates out', async () => {
  const sql = connection(),
    before = await version('activity_records');
  await sql`insert into activity_records.records(kind,id,revision,data)
    select 'activity',gen_random_uuid()::text,1,jsonb_build_object('localDate','2024-01-01','durationSeconds',60)
    from generate_series(1,1500)`;
  expect(await version('activity_records')).toBe(before + 1);
  await sql`update activity_records.records set data=data`;
  expect(await version('activity_records')).toBe(before + 1);
  await sql`update activity_records.records set data=data||'{"durationSeconds":120}'::jsonb`;
  expect(await version('activity_records')).toBe(before + 2);
  await sql`delete from activity_records.records`;
  expect(await version('activity_records')).toBe(before + 3);
});

it('keeps records, summaries and coverage pages consistent across identical completed and in-progress rescans', async () => {
  const { token } = await access(),
    sql = connection();
  await sql`update garmin.coverage set scanned_at='2024-03-01T00:00:00Z',updated_at='2024-03-01T00:00:00Z'`;
  const records = await readHistory(token, 'records', { category: 'coverage', limit: 1 });
  const summary = await readHistory(token, 'summary', {
    category: 'coverage',
    limit: 1,
    reviewToken: records.reviewToken,
  });
  const activityPage = await readHistory(token, 'records', {
    category: 'activities',
    limit: 1,
    reviewToken: records.reviewToken,
  });
  const expectedNextRecords = await readHistory(token, 'records', nextPage(records));
  const expectedNextSummary = await readHistory(token, 'summary', nextPage(summary));
  expect(records.records![0]!.data).toMatchObject({ scanState: 'scanned', hasCompletedScan: true });
  expect(records.records![0]!.data).not.toHaveProperty('lastScannedAt');
  expect(summary.summaries![0]).toMatchObject({ scannedDays: 7, unscannedDays: 24 });
  const before = await version('garmin');
  const reads = vi.spyOn(sources, 'historicalRecords');
  for (const scanState of ['in-progress', 'scanned'] as const) {
    await saveCoverage({ ...coverage, scanState });
    expect(await version('garmin')).toBe(before);
    const repeated = await readHistory(token, 'records', {
      ...records.query,
      reviewToken: records.reviewToken,
    });
    expect(repeated.records).toEqual(records.records);
    expect((await readHistory(token, 'records', nextPage(records))).records).toEqual(
      expectedNextRecords.records,
    );
    reads.mockClear();
    expect((await readHistory(token, 'summary', nextPage(summary))).summaries).toEqual(
      expectedNextSummary.summaries,
    );
    expect(reads).not.toHaveBeenCalled();
    expect((await readHistory(token, 'records', nextPage(activityPage))).records).toHaveLength(1);
  }
  const [operational] =
    await sql`select scanned_at from garmin.coverage where start_date='2024-01-01'`;
  expect(operational!.scanned_at.getTime()).toBeGreaterThan(Date.parse('2024-03-01'));
});

it('ignores zero-row coverage cleanup, conflict no-ops and empty truncation', async () => {
  const sql = connection(),
    before = await version('garmin');
  await sql`insert into garmin.coverage(stream,start_date,end_date,status) select 'activities','2024-01-01'::date,'2024-01-07'::date,'complete' where false`;
  await sql`update garmin.coverage set status=status where false`;
  await sql`delete from garmin.coverage where status='failed'`;
  await sql`truncate garmin.coverage`;
  expect(await version('garmin')).toBe(before);
  await saveCoverage();
  expect(await version('garmin')).toBe(before + 1);
  await sql`insert into garmin.coverage(stream,start_date,end_date,status) values('activities','2024-01-01','2024-01-07','complete') on conflict do nothing`;
  await sql`update garmin.coverage set records=records+1,missing_days=missing_days+1,diagnostics='[{"code":"synthetic"}]'::jsonb`;
  expect(await version('garmin')).toBe(before + 1); // These operational counts are not history facts.
  await sql`truncate garmin.coverage`;
  expect(await version('garmin')).toBe(before + 2);
});

it.each(['status', 'first-scan', 'bounds', 'delete', 'truncate', 'record-outside-range'] as const)(
  'still rejects old reviews for real %s changes',
  async (change) => {
    const { token } = await access(),
      sql = connection();
    if (change === 'first-scan') await sql`update garmin.coverage set scanned_at=null`;
    const first = await readHistory(token, 'records', { category: 'activities', limit: 1 });
    await readHistory(token, 'summary', { category: 'coverage', reviewToken: first.reviewToken });
    if (change === 'status')
      await sql`update garmin.coverage set scan_state='failed',status='failed'`;
    if (change === 'first-scan') await saveCoverage();
    if (change === 'bounds') await sql`update garmin.coverage set end_date=end_date+1`;
    if (change === 'delete') await sql`delete from garmin.coverage where start_date='2024-01-01'`;
    if (change === 'truncate') await sql`truncate garmin.coverage`;
    if (change === 'record-outside-range') {
      const record = syntheticDay('2025-01-01', 42).activities[0]!;
      await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${record.id},1,${sql.json(record)})`;
    }
    await expect(readHistory(token, 'records', nextPage(first))).rejects.toMatchObject({
      code: 'history_changed',
    });
    await expect(
      readHistory(token, 'summary', { category: 'coverage', reviewToken: first.reviewToken }),
    ).rejects.toMatchObject({ code: 'history_changed' });
  },
);

it.each(['identical', 'changed'] as const)(
  'handles a concurrent %s coverage scan during summary calculation',
  async (kind) => {
    const { token } = await access();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = sources.historicalRecords;
    vi.spyOn(sources, 'historicalRecords').mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      entered();
      await held;
      return rows;
    });
    const pending = readHistory(token, 'summary', { category: 'coverage' }).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    try {
      await reached;
      await saveCoverage(
        kind === 'identical'
          ? coverage
          : { ...coverage, scanState: 'unavailable', status: 'unavailable' },
      );
    } finally {
      release();
    }
    const result = await pending;
    if (kind === 'changed') expect(result.error).toMatchObject({ code: 'history_changed' });
    else {
      expect(result.error).toBeUndefined();
      expect(result.value!.summaries![0]).toMatchObject({ scannedDays: 7 });
    }
  },
);

it.each(['revoked', 'expired'] as const)(
  'still denies %s access after an unchanged rescan',
  async (kind) => {
    const { token, grant } = await access();
    const first = await readHistory(token, 'summary', { category: 'coverage', limit: 1 });
    await saveCoverage();
    if (kind === 'revoked') await revokeGrant({ id: grant.id });
    else
      await connection()`update host.grants set expires_at=clock_timestamp()-interval '1 second' where id=${grant.id}`;
    await expect(readHistory(token, 'summary', nextPage(first))).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  },
);
