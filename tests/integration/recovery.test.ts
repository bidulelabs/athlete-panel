import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, connection, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { enqueue, claimJob } from '../../packages/host/src/jobs';
import {
  configure,
  getConfiguration,
  runGarminJob,
  scheduleRecent,
  coveragePage,
  pause,
  sync,
} from '../../plugins/garmin/service';
import { scheduleRecovery } from '../../plugins/garmin/recovery';
import {
  RECOVERY_STREAMS,
  windowCursor,
  type RecoveryContext,
} from '../../plugins/garmin/recovery-policy';
import { addDays } from '../../plugins/garmin/sync';
import { GARMIN_ORIGIN, GARMIN_TOKEN_PATH } from '../../plugins/garmin/transport';
import { loadWorkspace } from '../../instance/services';
vi.mock('../../plugins/garmin/transport', async (original) => {
  const module = await original<typeof import('../../plugins/garmin/transport')>();
  return {
    ...module,
    createGarminClient: (options: Parameters<typeof module.createGarminClient>[0]) =>
      module.createGarminClient({ ...options, requestIntervalMs: 0 }),
  };
});
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('Explicit loopback *_test database required');
let context: RecoveryContext,
  fetcher: ReturnType<typeof vi.fn>,
  deniedSleep: boolean,
  throttle: boolean;
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.jobs,host.idempotency,host.changes,host.proposals,host.grants,athlete.records,training.records,activity_records.records,garmin.coverage,garmin.scan_state,garmin.scheduler`;
  await connection()`delete from host.settings where key in ('garmin','garminToken','maintenance')`;
  await configure({ key: 'synthetic-recovery-key' });
  const config = (await getConfiguration())!;
  await connection()`update host.settings set value=value || ${connection().json({ accountId: '555', verifiedGeneration: config.generation })} where key='garmin'`;
  await connection()`update host.jobs set status='completed'`;
  context = {
    today: new Date().toISOString().slice(0, 10),
    earliestDate: '2000-01-01',
    accountId: '555',
    generation: config.generation,
    timeZone: 'UTC',
  };
  deniedSleep = false;
  throttle = false;
  fetcher = vi.fn(async (input: URL | string) => {
    const target = new URL(input);
    expect(target.origin).toBe(GARMIN_ORIGIN);
    const response = (value: unknown, status = 200, headers?: HeadersInit) =>
      new Response(JSON.stringify(value), { status, headers });
    if (target.pathname === GARMIN_TOKEN_PATH)
      return new Response(
        `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.unsigned`,
      );
    if (throttle) {
      throttle = false;
      return response('private upstream', 429, { 'Retry-After': '125' });
    }
    if (target.pathname.includes('/activities/search/')) {
      const day = addDays(context.today, -365);
      const rows =
        target.searchParams.get('startDate') && target.searchParams.get('startDate')! > day
          ? []
          : [
              {
                activityId: '987654',
                ownerId: '555',
                startTimeGMT: `${day}T12:00:00Z`,
                duration: 600,
              },
            ];
      return response(rows.slice(Number(target.searchParams.get('start') ?? 0)));
    }
    if (target.pathname.includes('dailySleepSummaries'))
      return response([], deniedSleep ? 403 : 200);
    if (target.pathname.includes('dailysummaries')) return response({ data: [] });
    if (target.pathname.includes('/hrv/'))
      return response({ userProfilePk: '555', hrvSummaries: [] });
    return response([]);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(closeDatabase);
async function covered(through = context.today) {
  const sql = connection();
  for (const stream of RECOVERY_STREAMS)
    await sql`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,scanned_at) values(${stream},${stream === 'activities' ? '0001-01-01' : context.earliestDate},${through},'no-data','scanned',now())`;
}
async function step() {
  const job = await claimJob(randomUUID());
  expect(job).not.toBeNull();
  await runGarminJob(job!);
  return job!;
}

it('recovers an outage longer than seven days, behind recent work, using completed coverage', async () => {
  await covered(addDays(context.today, -30));
  for (const stream of RECOVERY_STREAMS)
    await connection()`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,scanned_at) values(${stream},${addDays(context.today, -6)},${context.today},'no-data','scanned',now())`;
  await scheduleRecent();
  const recent = await claimJob('recent');
  expect(recent?.kind).toBe('garmin-recent');
  await connection()`update host.jobs set status='completed',lease_owner=null,lease_until=null where id=${recent!.id}`;
  const catchup = await step();
  expect(catchup.kind).toBe('garmin-catchup');
  expect(catchup.payload.cursor.today).toBe(addDays(context.today, -7));
  expect(catchup.payload.cursor.activityFrom).toBe(addDays(context.today, -29));
  const rows =
    await connection()`select scan_state,status from garmin.coverage where stream='activities' and start_date=${addDays(context.today, -29)}`;
  expect(rows[0]).toEqual({ scan_state: 'scanned', status: 'no-data' });
  const unscanned = await coveragePage({ filter: 'unscanned' });
  expect(unscanned.total).toBeGreaterThan(0);
  expect(
    unscanned.rows.every((row) => row.scanState === 'unscanned' && row.lastScannedAt === null),
  ).toBe(true);
});
it('rotates all history streams, preserves activity pagination, imports late records and persists the five-minute budget across restarts', async () => {
  await covered();
  await transaction((tx) => scheduleRecovery(tx, context));
  const first = await step();
  expect(first.payload.recovery.stream).toBe('activities');
  expect((await loadWorkspace()).activities[0]?.localDate).toBe(addDays(context.today, -365));
  expect(
    (
      await connection()`select reconcile_cursor from garmin.scan_state where stream='activities'`
    )[0].reconcile_cursor.activityOffset,
  ).toBe(1);
  const calls = fetcher.mock.calls.length;
  await closeDatabase();
  await transaction((tx) => scheduleRecovery(tx, context));
  expect(await claimJob('restart')).toBeNull();
  // Even an early queued claim cannot bypass the persisted request budget.
  await connection()`update host.jobs set status='queued',next_run_at=now() where id=${first.id}`;
  await step();
  expect(fetcher.mock.calls).toHaveLength(calls);
  await connection()`update host.jobs set status='completed' where id=${first.id}`;
  const visited = new Set(['activities']);
  for (let n = 0; n < 6; n++) {
    await connection()`update garmin.scheduler set next_reconcile_at=now()-interval '1 second'`;
    await transaction((tx) => scheduleRecovery(tx, context));
    visited.add((await step()).payload.recovery.stream);
  }
  expect(visited.size).toBe(7);
  await connection()`update garmin.scheduler set next_reconcile_at=now()-interval '1 second'`;
  await transaction((tx) => scheduleRecovery(tx, context));
  const continuation = await step();
  expect(continuation.payload.cursor.activityOffset).toBe(1);
  expect(
    (
      await connection()`select reconcile_cursor from garmin.scan_state where stream='activities'`
    )[0].reconcile_cursor,
  ).toBeNull();
  expect(await connection()`select id from host.jobs where kind='garmin-reconcile'`).toHaveLength(
    1,
  );
});
it('suspends forbidden historical streams until a successful recent probe and keeps other streams eligible', async () => {
  await covered();
  await transaction((tx) => scheduleRecovery(tx, context));
  await connection()`update host.jobs set status='completed' where kind='garmin-reconcile'`;
  await connection()`update garmin.scan_state set last_scheduled_at=now()`;
  await connection()`update garmin.scan_state set last_scheduled_at=null where stream='sleep'`;
  deniedSleep = true;
  await transaction((tx) => scheduleRecovery(tx, context));
  expect((await step()).payload.recovery.stream).toBe('sleep');
  expect(
    (await connection()`select unavailable from garmin.scan_state where stream='sleep'`)[0]
      .unavailable,
  ).toBe(true);
  await connection()`update garmin.scheduler set next_reconcile_at=now()-interval '1 second'`;
  await transaction((tx) => scheduleRecovery(tx, context));
  expect((await step()).payload.recovery.stream).not.toBe('sleep');
  deniedSleep = false;
  const cursor = {
    ...windowCursor('sleep', { from: addDays(context.today, -6), to: context.today }, context),
    mode: 'recent' as const,
  };
  await transaction((tx) =>
    enqueue(tx, 'garmin', 'garmin-recent', { cursor, generation: context.generation }, 30),
  );
  await step();
  expect(
    (await connection()`select unavailable from garmin.scan_state where stream='sleep'`)[0]
      .unavailable,
  ).toBe(false);
});
it('honours provider backoff across job kinds and preserves pause controls', async () => {
  await covered();
  await transaction((tx) => scheduleRecovery(tx, context));
  throttle = true;
  const rejected = await step();
  expect(
    (await connection()`select attempts from host.jobs where id=${rejected.id}`)[0].attempts,
  ).toBe(1);
  const calls = fetcher.mock.calls.length;
  const cursor = {
    ...windowCursor('sleep', { from: addDays(context.today, -6), to: context.today }, context),
    mode: 'recent' as const,
  };
  await transaction((tx) =>
    enqueue(tx, 'garmin', 'garmin-recent', { cursor, generation: context.generation }, 30),
  );
  await step();
  expect(fetcher.mock.calls).toHaveLength(calls);
  expect(
    (
      await connection()`select next_run_at>now()+interval '2 minutes' as delayed from host.jobs where kind='garmin-recent'`
    )[0].delayed,
  ).toBe(true);
  await pause({ paused: true });
  expect(await claimJob('paused')).toBeNull();
});
it('keeps failed historical checkpoints visible and requires explicit repair before retrying that stream', async () => {
  await covered();
  await transaction((tx) => scheduleRecovery(tx, context));
  await connection()`update host.jobs set status='failed',attempts=8,error='lease_expired' where kind='garmin-reconcile'`;
  await transaction((tx) => scheduleRecovery(tx, context));
  expect(
    (await connection()`select needs_retry from garmin.scan_state where stream='activities'`)[0]
      .needs_retry,
  ).toBe(true);
  expect((await coveragePage({ filter: 'failed' })).rows[0]).toMatchObject({
    stream: 'activities',
    error: 'worker_checkpoint_failed',
  });
  const other = await step();
  expect(other.payload.recovery.stream).not.toBe('activities');
  await sync({
    mode: 'full',
    from: '0001-01-01',
    to: addDays(context.today, -7),
    stream: 'activities',
  });
  expect(
    (await connection()`select needs_retry from garmin.scan_state where stream='activities'`)[0]
      .needs_retry,
  ).toBe(false);
  expect(
    (
      await connection()`select status from host.jobs where kind='garmin-reconcile' and attempts=8`
    )[0].status,
  ).toBe('cancelled');
});
