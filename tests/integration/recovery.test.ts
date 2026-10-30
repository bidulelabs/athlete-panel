import { isolatedDatabaseUrl } from '../support/test-database';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, connection, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { enqueue, claimJob, failClaimedJob, type Job } from '../../packages/host/src/jobs';
import {
  configure,
  getConfiguration,
  runGarminJob,
  scheduleRecent,
  coveragePage,
  pause,
  sync,
  status,
  disconnect,
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
const url = isolatedDatabaseUrl();
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
it('never queues rescans of completed history across scheduler restarts', async () => {
  await covered();
  for (let attempt = 0; attempt < 3; attempt++) {
    await scheduleRecent();
    await closeDatabase();
  }
  expect(
    await connection()`select id from host.jobs where kind in ('garmin-catchup','garmin-reconcile')`,
  ).toHaveLength(0);
  expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await loadWorkspace()).activities).toHaveLength(0);
  // A late upload on an already scanned old date is picked up only by manual refresh.
  await connection()`update host.jobs set status='completed',lease_owner=null,lease_until=null where kind='garmin-recent'`;
  const oldDate = addDays(context.today, -365);
  await sync({ mode: 'full', from: oldDate, to: oldDate, scope: 'activities' });
  for (let n = 0; n < 3; n++) {
    await connection()`update host.jobs set next_run_at=now() where status='queued'`;
    await step();
  }
  expect((await loadWorkspace()).activities[0]?.localDate).toBe(oldDate);
});

async function legacyJob(state: string, stream: 'activities' | 'sleep' = 'activities') {
  const id = randomUUID();
  const payload = {
    cursor: windowCursor(stream, { from: '2025-01-01', to: '2025-01-28' }, context),
    generation: context.generation,
    recovery: { mode: 'reconcile', stream },
  };
  await connection()`insert into host.jobs(id,plugin_id,kind,status,payload,lease_owner,lease_until,error,attempts) values(${id},'garmin','garmin-reconcile',${state},${connection().json(payload)},'old-worker',now()+interval '3 minutes','retained diagnostic',3)`;
  return {
    id,
    plugin_id: 'garmin',
    kind: 'garmin-reconcile',
    status: state,
    payload,
    lease_owner: 'old-worker',
    attempts: 3,
    priority: 0,
    progress: {},
  } satisfies Job;
}

it.each(['queued', 'running', 'paused', 'disabled', 'failed'])(
  'retires %s reconciliation even while paused, retaining checkpoints and diagnostics',
  async (state) => {
    await covered();
    await transaction((tx) => scheduleRecovery(tx, context));
    await pause({ paused: true });
    const job = await legacyJob(state);
    await scheduleRecent();
    await scheduleRecent();
    await runGarminJob(job);
    await failClaimedJob(job);
    expect(
      (
        await connection()`select status,payload,error,attempts,lease_owner,lease_until from host.jobs where id=${job.id}`
      )[0],
    ).toEqual({
      status: 'cancelled',
      payload: job.payload,
      error: 'retained diagnostic',
      attempts: 3,
      lease_owner: null,
      lease_until: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await status()).recovery).toMatchObject({
      reconciliation: null,
      nextReconcileAt: null,
    });
  },
);

it('retires disconnected jobs and fences cancellation-only handlers against stale leases and payloads', async () => {
  await disconnect();
  const job = await legacyJob('running');
  await runGarminJob({ ...job, lease_owner: 'stale-worker' });
  await runGarminJob({ ...job, payload: {} });
  expect((await connection()`select status from host.jobs where id=${job.id}`)[0].status).toBe(
    'running',
  );
  await runGarminJob(job);
  expect((await connection()`select status from host.jobs where id=${job.id}`)[0].status).toBe(
    'cancelled',
  );
  const queued = await legacyJob('queued');
  await scheduleRecent();
  expect((await connection()`select status from host.jobs where id=${queued.id}`)[0].status).toBe(
    'cancelled',
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['none', 'job', 'coverage'])(
  'clears only reconciliation-only retry gates with independent failure: %s',
  async (independent) => {
    await covered();
    await transaction((tx) => scheduleRecovery(tx, context));
    const job = await legacyJob('failed', 'sleep');
    await connection()`update garmin.scan_state set needs_retry=true where stream='sleep'`;
    await connection()`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,error) values('sleep','2025-01-01','2025-01-28','failed','failed','retained failure')`;
    if (independent === 'job')
      await connection()`insert into host.jobs(id,plugin_id,kind,status,payload) values(${randomUUID()},'garmin','garmin-history','failed',${connection().json(job.payload)})`;
    if (independent === 'coverage')
      await connection()`insert into garmin.coverage(stream,start_date,end_date,status,scan_state) values('sleep','2024-01-01','2024-01-28','failed','failed')`;
    await pause({ paused: true });
    await scheduleRecent();
    expect(
      (await connection()`select needs_retry from garmin.scan_state where stream='sleep'`)[0]
        .needs_retry,
    ).toBe(independent !== 'none');
    expect((await coveragePage({ filter: 'failed' })).total).toBe(
      independent === 'coverage' ? 2 : 1,
    );
  },
);

it.each(['activities', 'health'] as const)(
  'pending %s refresh only reserves its selected streams from catch-up',
  async (scope) => {
    await covered();
    await transaction((tx) => scheduleRecovery(tx, context));
    await connection()`truncate garmin.coverage`;
    await connection()`update garmin.scan_state set needs_retry=true`;
    await sync({
      mode: 'full',
      from: scope === 'activities' ? '0001-01-01' : '2000-01-01',
      to: context.today,
      scope,
    });
    const states = await connection()`select stream,needs_retry from garmin.scan_state`;
    expect(
      states.every(
        (state) =>
          state.needs_retry ===
          (scope === 'activities' ? state.stream !== 'activities' : state.stream === 'activities'),
      ),
    ).toBe(true);
    await connection()`update garmin.scan_state set needs_retry=false`;
    await transaction((tx) => scheduleRecovery(tx, context));
    const [job] = await connection()`select payload from host.jobs where kind='garmin-catchup'`;
    expect(job.payload.recovery.stream === 'activities').toBe(scope === 'health');
  },
);
it('suspends forbidden historical streams until a successful recent probe and keeps other streams eligible', async () => {
  await covered(addDays(context.today, -30));
  await transaction((tx) => scheduleRecovery(tx, context));
  await connection()`update host.jobs set status='completed' where kind='garmin-catchup'`;
  await connection()`update garmin.scan_state set last_scheduled_at=now()`;
  await connection()`update garmin.scan_state set last_scheduled_at=null where stream='sleep'`;
  deniedSleep = true;
  await transaction((tx) => scheduleRecovery(tx, context));
  expect((await step()).payload.recovery.stream).toBe('sleep');
  expect(
    (await connection()`select unavailable from garmin.scan_state where stream='sleep'`)[0]
      .unavailable,
  ).toBe(true);
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
  await covered(addDays(context.today, -30));
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
  await covered(addDays(context.today, -30));
  await transaction((tx) => scheduleRecovery(tx, context));
  await connection()`update host.jobs set status='failed',attempts=8,error='lease_expired' where kind='garmin-catchup'`;
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
    (await connection()`select status from host.jobs where kind='garmin-catchup' and attempts=8`)[0]
      .status,
  ).toBe('cancelled');
});
