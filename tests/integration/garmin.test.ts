import { isolatedDatabaseUrl } from '../support/test-database';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, connection, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import {
  claimJob,
  enqueue,
  workerHeartbeat,
  workerFailure,
  type Job,
} from '../../packages/host/src/jobs';
import { loadWorkspace } from '../../instance/services';
import { recordsRepository } from '../../plugins/activity-records/repository';
import { mutate } from '../../plugins/training/service';
import {
  configure,
  disconnect,
  getConfiguration,
  runGarminJob,
  status,
  sync,
  coveragePage,
  scheduleRecent,
  pause,
} from '../../plugins/garmin/service';
import { createSyncCursor, type GarminSyncCursor } from '../../plugins/garmin/sync';
import { GARMIN_HEALTH_HISTORY_START } from '../../plugins/garmin/history-policy';
import { GARMIN_ORIGIN, GARMIN_TOKEN_PATH } from '../../plugins/garmin/transport';

// Pacing has dedicated transport unit coverage. Keep this DB suite deterministic and fast.
vi.mock('../../plugins/garmin/transport', async (original) => {
  const module = await original<typeof import('../../plugins/garmin/transport')>();
  return {
    ...module,
    createGarminClient: (options: Parameters<typeof module.createGarminClient>[0]) =>
      module.createGarminClient({ ...options, requestIntervalMs: 0 }),
  };
});

const suppliedUrl = isolatedDatabaseUrl();
const key = 'synthetic-personal-key-never-valid';
const day = '2026-10-24';
const activityRow = (overrides: Record<string, unknown> = {}) => ({
  activityId: '9007199254740993123',
  ownerId: '555',
  activityName: 'Synthetic ride',
  activityType: { typeKey: 'road_biking' },
  startTimeGMT: `${day} 06:00:00`,
  startTimeLocal: `${day} 08:00:00`,
  duration: 3600,
  distance: 20000,
  ...overrides,
});
const token = () =>
  `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.not-a-signature`;
const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

describe('durable Garmin worker with synthetic Personal API', () => {
  let activities: Record<string, unknown>[];
  let sleepRows: Record<string, unknown>[];
  let tokenFailure: number | null;
  let nextFailure: { status: number; headers?: HeadersInit } | null;
  let blockActivity: (() => Promise<Response>) | null;
  let fetcher: ReturnType<typeof vi.fn>;
  const originalEncryption = process.env.ENCRYPTION_KEY;

  beforeAll(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = suppliedUrl!;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    await migrate();
  });
  beforeEach(async () => {
    await connection()`truncate host.jobs, host.proposals, host.grants, host.changes, host.idempotency, athlete.records, training.records, activity_records.records, garmin.coverage, garmin.scan_state, garmin.scheduler`;
    await connection()`delete from host.settings where key in ('garmin','garminToken','maintenance')`;
    activities = [activityRow()];
    sleepRows = [];
    tokenFailure = null;
    nextFailure = null;
    blockActivity = null;
    fetcher = vi.fn(async (input: URL | string, init: RequestInit) => {
      const url = new URL(input);
      // Fail closed: every request is intercepted, no fallback to the network exists.
      if (url.origin !== GARMIN_ORIGIN)
        throw new Error('Unexpected external origin in synthetic test');
      if (url.pathname === GARMIN_TOKEN_PATH) {
        expect(init.method).toBe('POST');
        return tokenFailure ? response('sensitive upstream body', tokenFailure) : response(token());
      }
      expect(init.method).toBe('GET');
      if (nextFailure) {
        const failure = nextFailure;
        nextFailure = null;
        return response('sensitive upstream body', failure.status, failure.headers);
      }
      if (url.pathname.includes('/activities/search/')) {
        if (blockActivity) return blockActivity();
        const start = Number(url.searchParams.get('start') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 99);
        return response(activities.slice(start, start + limit));
      }
      if (url.pathname.includes('dailySleepSummaries')) return response(sleepRows);
      if (url.pathname.includes('/dailysummaries')) return response({ data: [] });
      if (url.pathname.includes('/hrv/'))
        return response({ userProfilePk: '555', hrvSummaries: [] });
      return response([]);
    });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeDatabase();
    if (originalEncryption === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryption;
  });

  async function takeStep(): Promise<{ job: Job; saved: Record<string, any> }> {
    await connection()`update host.jobs set next_run_at=now() where status='queued'`;
    const job = await claimJob(randomUUID());
    expect(job).not.toBeNull();
    await runGarminJob(job!);
    const [saved] = await connection()`select * from host.jobs where id=${job!.id}`;
    return { job: job!, saved };
  }
  async function bootstrap() {
    await configure({ key, earliestDate: '2026-10-01' });
    const cursor = createSyncCursor({
      today: day,
      earliestHealthDate: '2026-10-01',
      timeZone: 'Europe/Paris',
    });
    const config = (await getConfiguration())!;
    await connection()`update host.jobs set payload=${connection().json({ cursor, generation: config.generation })} where plugin_id='garmin'`;
    const first = await takeStep();
    expect(first.saved.payload.cursor.phase).toBe('recent-activities');
    expect((await getConfiguration())?.accountId).toBe('555');
    return first;
  }
  async function scheduleCursor(overrides: Partial<GarminSyncCursor>) {
    const config = (await getConfiguration())!;
    const cursor = {
      ...createSyncCursor({
        today: day,
        earliestHealthDate: '2026-10-01',
        accountId: '555',
        timeZone: 'Europe/Paris',
        mode: 'recent',
      }),
      ...overrides,
    };
    await transaction(async (tx) => {
      await tx`update host.jobs set status='completed' where plugin_id='garmin' and kind='garmin-recent'`;
      await enqueue(tx, 'garmin', 'garmin-recent', { cursor, generation: config.generation }, 30);
    });
  }

  it('connects without a date and defaults full history to the internal boundary', async () => {
    await configure({ key });
    expect((await getConfiguration())?.earliestDate).toBe(GARMIN_HEALTH_HISTORY_START);
    const [job] = await connection()`select id,payload from host.jobs where kind='garmin-history'`;
    expect(job.payload.cursor.earliestHealthDate).toBe(GARMIN_HEALTH_HISTORY_START);
    expect(job.payload.cursor).not.toHaveProperty('activityFrom');
    expect((await sync({ mode: 'full' })).id).toBe(job.id);
  });

  it('schedules recent imports at the hourly boundary and preserves active retry work', async () => {
    await configure({ key });
    await scheduleRecent();
    const [first] = await connection()`select id from host.jobs where kind='garmin-recent'`;
    const started = Date.parse('2026-10-25T12:00:00.000Z');
    await connection()`update host.jobs set status='completed',created_at=${new Date(started)} where id=${first.id}`;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started + 3_599_999);
    await scheduleRecent();
    expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(1);

    clock.mockReturnValue(started + 3_600_000);
    await Promise.all([scheduleRecent(), scheduleRecent()]);
    const queued =
      await connection()`select * from host.jobs where kind='garmin-recent' and status='queued'`;
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.cursor.mode).toBe('recent');
    expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(2);

    const retryAt = new Date(started + 10_800_000);
    await connection()`update host.jobs set created_at=${new Date(started)},next_run_at=${retryAt},attempts=2,error='Synthetic throttling' where id=${queued[0].id}`;
    clock.mockReturnValue(started + 7_200_000);
    await scheduleRecent();
    const active =
      await connection()`select id,next_run_at,attempts from host.jobs where kind='garmin-recent' and status='queued'`;
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: queued[0].id, next_run_at: retryAt, attempts: 2 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps automatic imports disabled when disconnected or paused', async () => {
    await scheduleRecent();
    expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(0);
    await configure({ key });
    await pause({ paused: true });
    await scheduleRecent();
    expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(0);
    await pause({ paused: false });
    await scheduleRecent();
    expect(await connection()`select id from host.jobs where kind='garmin-recent'`).toHaveLength(1);
    await disconnect();
    await scheduleRecent();
    expect(
      await connection()`select id from host.jobs where kind='garmin-recent' and status in ('queued','running')`,
    ).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('expands legacy history without replacing credentials or resetting progress', async () => {
    const first = await bootstrap();
    await connection()`update host.settings set value=jsonb_set(value,'{earliestDate}','"2026-01-01"'::jsonb) where key='garmin'`;
    const before = (await getConfiguration())!;
    const { saved } = await takeStep();
    const result = await sync({ mode: 'full', from: '2026-01-01' }); // stale UI field is ignored
    expect(result.id).toBe(first.job.id);
    const [after] = await connection()`select payload from host.jobs where id=${result.id}`;
    expect(after.payload.cursor).toEqual({
      ...saved.payload.cursor,
      earliestHealthDate: GARMIN_HEALTH_HISTORY_START,
    });
    expect(await getConfiguration()).toEqual({
      ...before,
      earliestDate: GARMIN_HEALTH_HISTORY_START,
    });
    expect((await loadWorkspace()).activities).toHaveLength(1);
  });

  it('starts an expanded job after a completed legacy import without touching imported data', async () => {
    await bootstrap();
    await takeStep();
    const before = await loadWorkspace();
    await connection()`update host.jobs set status='completed' where plugin_id='garmin'`;
    await connection()`update host.settings set value=jsonb_set(value,'{earliestDate}','"2026-01-01"'::jsonb) where key='garmin'`;
    const result = await sync({ mode: 'full' });
    const [job] = await connection()`select payload from host.jobs where id=${result.id}`;
    expect(job.payload.cursor).toMatchObject({
      phase: 'identity',
      earliestHealthDate: GARMIN_HEALTH_HISTORY_START,
    });
    expect(await loadWorkspace()).toEqual(before);
    await expect(sync({ mode: 'full', to: day })).rejects.toMatchObject({ code: 'invalid_range' });
  });

  it.each([false, true])(
    'does not let an in-flight response overwrite an expanded checkpoint (failure=%s)',
    async (failed) => {
      await bootstrap();
      await connection()`update host.jobs set next_run_at=now() where status='queued'`;
      const job = (await claimJob('worker-before-expansion'))!;
      let release!: (value: Response) => void;
      let requested!: () => void;
      const started = new Promise<void>((resolve) => {
        requested = resolve;
      });
      blockActivity = async () => {
        requested();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      };
      const pending = runGarminJob(job);
      await started;
      expect((await sync({ mode: 'full' })).id).toBe(job.id);
      release(failed ? response('private upstream detail', 500) : response(activities));
      await pending;
      const [saved] =
        await connection()`select status,payload,error,lease_owner from host.jobs where id=${job.id}`;
      expect(saved).toMatchObject({ status: 'queued', error: null, lease_owner: null });
      expect(saved.payload.cursor).toEqual({
        ...job.payload.cursor,
        earliestHealthDate: GARMIN_HEALTH_HISTORY_START,
      });
      expect((await loadWorkspace()).activities).toHaveLength(0);
      expect((await getConfiguration())?.lastError).toBeNull();
    },
  );

  it('commits imported records, account binding and checkpoint together with encrypted credentials', async () => {
    await bootstrap();
    const { saved } = await takeStep();
    const state = await loadWorkspace();
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      externalId: '555:9007199254740993123',
      revision: 1,
      durationSeconds: 3600,
      localDate: day,
      provenance: { sourceAccountId: '555', source: 'activities' },
    });
    expect(saved.payload.cursor.activityOffset).toBe(1);
    expect(saved.status).toBe('queued');
    const stored =
      await connection()`select key,value from host.settings where key in ('garmin','garminToken')`;
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(stored)).not.toContain('not-a-signature');
    expect(await status()).toMatchObject({ connected: true, verified: true });
  });

  it('replays the same import without duplicates and refreshes linked actuals on provider correction', async () => {
    await bootstrap();
    await takeStep();
    const before = (await loadWorkspace()).activities[0];
    await scheduleCursor({ phase: 'recent-activities' });
    await takeStep();
    let state = await loadWorkspace();
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0].revision).toBe(1);
    const workoutId = randomUUID();
    await mutate({
      idempotencyKey: randomUUID(),
      commands: [
        {
          action: 'workout.create',
          values: {
            id: workoutId,
            title: 'Planned ride',
            sport: 'cycling',
            schedule: { kind: 'independent', date: day },
          },
        },
        {
          action: 'workout.complete',
          id: workoutId,
          expectedRevision: 1,
          values: {
            status: 'partial',
            performedDate: day,
            reason: 'Fatigue',
            notes: 'Preserve this annotation',
            rpe: 7,
          },
        },
        { action: 'workout.link', id: workoutId, expectedRevision: 1, activityId: before.id },
      ],
    });
    activities = [
      activityRow({
        duration: 4200,
        distance: 22000,
        trainingStressScore: 0,
        intensityFactor: 1.1,
        normPower: 230,
        activityType: { typeKey: 'gravel_cycling' },
      }),
    ];
    await scheduleCursor({ phase: 'recent-activities' });
    await takeStep();
    state = await loadWorkspace();
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      id: before.id,
      revision: 2,
      durationSeconds: 4200,
      trainingStressScore: 0,
      intensityFactor: 1.1,
      normalizedPowerWatts: 230,
      sportSubgroup: 'gravel_cycling',
    });
    expect(state.workouts[0].completion).toMatchObject({
      source: 'garmin',
      status: 'partial',
      reason: 'Fatigue',
      notes: 'Preserve this annotation',
      rpe: 7,
      durationSeconds: 4200,
      distanceMeters: 22000,
    });
    expect(state.workouts[0].revision).toBe(2);
  });

  it('finds a moved unlinked activity by stable identity without reading the complete imported history', async () => {
    await bootstrap();
    await takeStep();
    const before = (await loadWorkspace()).activities[0];
    activities = [
      activityRow({
        startTimeGMT: '2026-11-04 06:00:00',
        startTimeLocal: '2026-11-04 07:00:00',
        duration: 4200,
      }),
    ];
    await scheduleCursor({
      phase: 'recent-activities',
      today: '2026-11-04',
      windowEnd: '2026-11-04',
    });
    const fullRead = vi.spyOn(recordsRepository, 'list');
    try {
      const { saved } = await takeStep();
      expect(saved.status).toBe('queued');
      expect(fullRead).not.toHaveBeenCalled();
    } finally {
      fullRead.mockRestore();
    }
    const state = await loadWorkspace();
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      id: before.id,
      externalId: before.externalId,
      revision: 2,
      localDate: '2026-11-04',
      durationSeconds: 4200,
    });
  });

  it('imports selected sleep metrics with null/zero distinction and stable metric identities', async () => {
    await bootstrap();
    sleepRows = [
      {
        calendarDate: day,
        sleepTimeSeconds: 28800,
        deepSleepSeconds: 0,
        lightSleepSeconds: 22000,
        remSleepSeconds: null,
        sleepScores: { overall: { value: 80 } },
      },
    ];
    await scheduleCursor({ phase: 'recent-health', healthStreamIndex: 0, windowEnd: day });
    await takeStep();
    let state = await loadWorkspace();
    expect(state.health).toHaveLength(6);
    expect(state.health.find((record) => record.metric === 'sleepDeepSeconds')?.value).toBe(0);
    expect(state.health.find((record) => record.metric === 'sleepRemSeconds')?.value).toBeNull();
    expect(new Set(state.health.map((record) => record.externalId)).size).toBe(6);
    await scheduleCursor({ phase: 'recent-health', healthStreamIndex: 0, windowEnd: day });
    await takeStep();
    state = await loadWorkspace();
    expect(state.health).toHaveLength(6);
    expect(state.health.every((record) => record.revision === 1)).toBe(true);
    expect(
      (await status()).coverage.some(
        (record) => record.stream === 'sleep' && record.status === 'partial',
      ),
    ).toBe(true);
  });

  it('rejects a provider subgroup correction atomically when it would invalidate a confirmed link', async () => {
    await bootstrap();
    await takeStep();
    const activity = (await loadWorkspace()).activities[0];
    const workoutId = randomUUID();
    await mutate({
      idempotencyKey: randomUUID(),
      commands: [
        {
          action: 'workout.create',
          values: {
            id: workoutId,
            title: 'Confirmed cycling session',
            sport: 'cycling',
            sportSubgroup: 'road_biking',
            schedule: { kind: 'independent', date: day },
          },
        },
        { action: 'workout.link', id: workoutId, expectedRevision: 1, activityId: activity.id },
      ],
    });
    const before = await loadWorkspace();
    activities = [activityRow({ activityType: { typeKey: 'gravel_cycling' } })];
    await scheduleCursor({ phase: 'recent-activities' });
    const { job, saved } = await takeStep();
    expect(saved.status).toBe('failed');
    expect(saved.payload.cursor).toEqual(job.payload.cursor);
    expect(await loadWorkspace()).toEqual(before);
    expect((await status()).lastError).toMatch(/link|validation/i);
  });

  it('commits valid neighbours with rejection diagnostics and clears them after a repaired scan', async () => {
    await bootstrap();
    activities = [
      activityRow(),
      activityRow({ activityId: '9007199254740993124', startTimeGMT: 'invalid' }),
    ];
    const { saved } = await takeStep();
    expect(saved.status).toBe('queued');
    expect(saved.payload.cursor.activityOffset).toBe(2);
    expect((await loadWorkspace()).activities).toHaveLength(1);
    const rejected = await coveragePage({ filter: 'rejected' });
    expect(rejected.rows[0]).toMatchObject({
      status: 'partial',
      scanState: 'in-progress',
      rejectedRecords: 1,
    });
    expect(rejected.rows[0].diagnostics[0].fields).toEqual(['startTimeGMT']);
    expect(JSON.stringify(rejected.rows[0].diagnostics)).not.toContain('Synthetic ride');
    await takeStep();
    expect((await coveragePage({ filter: 'rejected' })).rows[0].scanState).toBe('scanned');
    await connection()`update host.jobs set status='completed',lease_owner=null,lease_until=null where plugin_id='garmin'`;
    activities[1] = activityRow({ activityId: '9007199254740993124' });
    await sync({
      mode: 'full',
      from: rejected.rows[0].from,
      to: rejected.rows[0].to,
      stream: 'activities',
    });
    await takeStep();
    await takeStep();
    // A partial replacement does not erase the prior completed scan's diagnostics.
    expect((await coveragePage({ filter: 'rejected' })).rows[0].rejectedRecords).toBe(1);
    await takeStep();
    expect((await coveragePage({ filter: 'rejected' })).total).toBe(0);
    expect((await loadWorkspace()).activities).toHaveLength(2);
  });

  it('persists throttled retry timing without advancing the checkpoint or exposing responses', async () => {
    await bootstrap();
    nextFailure = { status: 429, headers: { 'Retry-After': '125' } };
    const started = Date.now();
    const { job, saved } = await takeStep();
    expect(saved.status).toBe('queued');
    expect(saved.attempts).toBe(1);
    expect(saved.payload.cursor).toEqual(job.payload.cursor);
    expect(new Date(saved.next_run_at).getTime()).toBeGreaterThanOrEqual(started + 124000);
    expect(saved.error).not.toContain('sensitive');
    expect((await loadWorkspace()).activities).toHaveLength(0);
  });

  it('records the exact failed sleep window and resumes it without restarting historical traversal', async () => {
    const first = await bootstrap();
    const config = (await getConfiguration())!;
    const cursor: GarminSyncCursor = {
      ...first.saved.payload.cursor,
      phase: 'history-health',
      earliestHealthDate: '2026-01-01',
      windowEnd: '2026-08-22',
      healthStreamIndex: 0,
    };
    await connection()`update host.jobs set payload=${connection().json({ cursor, generation: config.generation })} where id=${first.job.id}`;
    nextFailure = { status: 400 };
    const failed = await takeStep();
    expect(failed.saved.status).toBe('failed');
    expect(failed.saved.payload.cursor).toEqual(cursor);
    const failedCoverage =
      await connection()`select stream,start_date::text as "from",end_date::text as "to",status,missing_days,unknown_metrics from garmin.coverage`;
    expect(failedCoverage).toEqual([
      {
        stream: 'sleep',
        from: '2026-07-26',
        to: '2026-08-22',
        status: 'failed',
        missing_days: 28,
        unknown_metrics: 168,
      },
    ]);
    const sleepCall = fetcher.mock.calls.find(([url]) =>
      String(url).includes('dailySleepSummaries'),
    );
    expect(new URL(String(sleepCall?.[0])).searchParams.get('startDate')).toBe('2026-07-26');
    expect(new URL(String(sleepCall?.[0])).searchParams.get('endDate')).toBe('2026-08-22');

    // A prior matching failure must not displace the most recent saved checkpoint.
    await connection()`insert into host.jobs(id,plugin_id,kind,status,payload,updated_at) values(${randomUUID()},'garmin','garmin-history','failed',${connection().json({ cursor: { ...cursor, phase: 'history-activities' }, generation: config.generation })},now()-interval '1 day')`;
    const resumed = await sync({ mode: 'full', from: '2026-01-01' });
    expect(resumed).toEqual({ id: first.job.id, status: 'queued' });
    const [queued] =
      await connection()`select payload,attempts,error from host.jobs where id=${resumed.id}`;
    expect(queued.payload.cursor).toEqual({
      ...cursor,
      earliestHealthDate: GARMIN_HEALTH_HISTORY_START,
    });
    expect(queued.attempts).toBe(0);
    expect(queued.error).toBeNull();

    // Backward compatibility: the old phase-key row must disappear on this same window's success.
    await connection()`insert into garmin.coverage(stream,start_date,end_date,status,error) values('history-health','2026-01-01','2026-08-22','failed','Synthetic legacy error')`;
    sleepRows = [
      {
        id: null,
        calendarDate: null,
        sleepTimeSeconds: null,
        sleepStartTimestampGMT: null,
        sleepEndTimestampGMT: null,
        deviceRemCapable: true,
        retro: false,
        sleepNeed: {},
        nextSleepNeed: {},
        napTimeSeconds: 0,
        dailyNapDTOS: [],
      },
      {
        calendarDate: '2026-08-22',
        sleepTimeSeconds: 28800,
        deepSleepSeconds: 0,
        lightSleepSeconds: 22000,
        remSleepSeconds: null,
        awakeSleepSeconds: 0,
        sleepScores: { overall: { value: 80 } },
      },
    ];
    const successful = await takeStep();
    expect(successful.job.id).toBe(first.job.id);
    expect(successful.saved.payload.cursor).toMatchObject({
      phase: 'history-health',
      windowEnd: '2026-08-22',
      healthStreamIndex: 1,
    });
    expect((await getConfiguration())?.lastError).toBeNull();
    const coverage =
      await connection()`select stream,start_date::text as "from",end_date::text as "to",status,records,error,missing_days,unknown_metrics from garmin.coverage`;
    expect(coverage).toEqual([
      {
        stream: 'sleep',
        from: '2026-07-26',
        to: '2026-08-22',
        status: 'partial',
        records: 6,
        error: null,
        missing_days: 27,
        unknown_metrics: 163,
      },
    ]);
    expect((await loadWorkspace()).health).toHaveLength(6);
    expect(
      (await loadWorkspace()).health.find((record) => record.metric === 'sleepRemSeconds')?.value,
    ).toBeNull();
  });

  it('reuses only the matching targeted scope and rejects a different active range', async () => {
    await bootstrap();
    await connection()`update host.jobs set status='completed' where plugin_id='garmin'`;
    const original = await sync({ mode: 'full', from: '2026-07-01', to: '2026-08-31' });
    await connection()`update host.jobs set status='failed',attempts=8,error='Synthetic exhaustion',payload=jsonb_set(payload,'{cursor,phase}','"history-health"'::jsonb) where id=${original.id}`;
    const [before] = await connection()`select payload from host.jobs where id=${original.id}`;
    const different = await sync({ mode: 'full', from: '2026-06-01', to: '2026-08-31' });
    expect(different.id).not.toBe(original.id);
    await expect(
      sync({ mode: 'full', from: '2026-07-01', to: '2026-08-31' }),
    ).rejects.toMatchObject({ code: 'import_busy' });
    await connection()`update host.jobs set status='completed' where id=${different.id}`;
    const resumed = await sync({ mode: 'full', from: '2026-07-01', to: '2026-08-31' });
    expect(resumed.id).toBe(original.id);
    expect(
      (await connection()`select payload from host.jobs where id=${original.id}`)[0].payload,
    ).toEqual(before.payload);
    expect(await sync({ mode: 'full', from: '2026-07-01', to: '2026-08-31' })).toEqual(resumed);
    await expect(
      sync({ mode: 'full', from: '2026-07-01', to: '2026-08-30' }),
    ).rejects.toMatchObject({ code: 'import_busy' });
    await expect(sync({ mode: 'full', from: '2026-07-01' })).rejects.toMatchObject({
      code: 'import_busy',
    });
  });

  it('does not resume a failed recent import whose end date belongs to an older week', async () => {
    await bootstrap();
    const config = (await getConfiguration())!;
    const staleId = randomUUID();
    const cursor = {
      ...createSyncCursor({
        today: '2020-01-10',
        earliestHealthDate: '2019-01-01',
        mode: 'recent',
        accountId: '555',
      }),
      phase: 'recent-health',
    };
    await connection()`insert into host.jobs(id,plugin_id,kind,status,payload) values(${staleId},'garmin','garmin-recent','failed',${connection().json({ cursor, generation: config.generation })})`;
    const fresh = await sync({ mode: 'recent', from: '2019-01-01' });
    expect(fresh.id).not.toBe(staleId);
    expect((await connection()`select status from host.jobs where id=${staleId}`)[0].status).toBe(
      'failed',
    );
    expect(
      (await connection()`select payload from host.jobs where id=${fresh.id}`)[0].payload.cursor
        .today,
    ).not.toBe('2020-01-10');
  });

  it('removes credentials while retaining history, then blocks a replacement key for another account', async () => {
    await bootstrap();
    await takeStep();
    const initial = (await loadWorkspace()).activities;
    await disconnect();
    expect((await status()).connected).toBe(false);
    expect(
      await connection()`select value from host.settings where key='garminToken'`,
    ).toHaveLength(0);
    expect((await loadWorkspace()).activities).toEqual(initial);
    activities = [activityRow({ ownerId: '999' })];
    await configure({ key: 'different-synthetic-personal-key', earliestDate: '2026-10-01' });
    await takeStep();
    expect((await getConfiguration())?.paused).toBe(true);
    expect((await getConfiguration())?.accountId).toBe('555');
    expect((await loadWorkspace()).activities).toEqual(initial);
  });

  it('rejects expired/revoked credentials while preserving durable imported data', async () => {
    await bootstrap();
    await takeStep();
    const initial = (await loadWorkspace()).activities;
    tokenFailure = 401;
    await configure({ key: 'revoked-synthetic-personal-key', earliestDate: '2026-10-01' });
    await takeStep();
    expect((await getConfiguration())?.paused).toBe(true);
    expect((await loadWorkspace()).activities).toEqual(initial);
    expect((await status()).lastError).not.toContain('sensitive');
  });

  it('removes a legacy cutoff on key replacement while preserving the active checkpoint', async () => {
    await bootstrap();
    await takeStep();
    const [before] =
      await connection()`select id,payload from host.jobs where kind='garmin-history' and status='queued'`;
    expect(before.payload.cursor.activityOffset).toBe(1);
    await configure({ key: 'replacement-synthetic-personal-key', earliestDate: '2020-01-01' });
    const [after] =
      await connection()`select id,payload from host.jobs where kind='garmin-history' and status='queued'`;
    expect(after.id).toBe(before.id);
    expect(after.payload.cursor.activityOffset).toBe(1);
    expect(after.payload.cursor.earliestHealthDate).toBe(GARMIN_HEALTH_HISTORY_START);
    expect((await loadWorkspace()).activities).toHaveLength(1);
  });

  it('discards a successful response after losing the worker lease', async () => {
    await bootstrap();
    await connection()`update host.jobs set next_run_at=now() where status='queued'`;
    const job = (await claimJob('worker-old'))!;
    let release!: (response: Response) => void;
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    blockActivity = async () => {
      requested();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const running = runGarminJob(job);
    await started;
    await connection()`update host.jobs set lease_owner='worker-new' where id=${job.id}`;
    release(response(activities));
    await running;
    expect((await loadWorkspace()).activities).toHaveLength(0);
    const [saved] = await connection()`select * from host.jobs where id=${job.id}`;
    expect(saved.lease_owner).toBe('worker-new');
    expect(saved.payload.cursor).toEqual(job.payload.cursor);
  });

  it('discards a failed response after losing the worker lease without changing connection status', async () => {
    await bootstrap();
    await connection()`update host.jobs set next_run_at=now() where status='queued'`;
    const job = (await claimJob('worker-old'))!;
    let release!: (response: Response) => void;
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    blockActivity = async () => {
      requested();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const running = runGarminJob(job);
    await started;
    await connection()`update host.jobs set lease_owner='worker-new' where id=${job.id}`;
    release(response('sensitive failed response', 500));
    await running;
    expect((await getConfiguration())?.lastError).toBeNull();
    expect(await connection()`select * from garmin.coverage where status='failed'`).toHaveLength(0);
    const [saved] = await connection()`select * from host.jobs where id=${job.id}`;
    expect(saved.lease_owner).toBe('worker-new');
  });
  it('keeps old failed coverage discoverable and counts unavailable windows truthfully', async () => {
    await configure({ key });
    const sql = connection();
    await sql`update host.settings set value=value || jsonb_build_object('verifiedGeneration',value->>'generation') where key='garmin'`;
    await sql`insert into garmin.coverage(stream,start_date,end_date,status) values ('history-health','2001-01-01','2001-01-28','failed'),('sleep','2001-02-01','2001-02-28','unavailable')`;
    await sql`insert into garmin.coverage(stream,start_date,end_date,status) select 'history-health','2025-01-01'::date+day,'2025-01-01'::date+day,'no-data' from generate_series(0,300) day`;
    const result = await status();
    expect(result.coverageSummary).toMatchObject({ windows: 303, failed: 1, unavailable: 1 });
    expect(result.status).toContain('needs attention');
    expect(result.coverage.some((row) => row.status === 'failed')).toBe(false);
    expect(await coveragePage({ filter: 'failed' })).toMatchObject({
      total: 1,
      rows: [{ from: '2001-01-01', status: 'failed' }],
    });
    expect((await coveragePage({ filter: 'all', offset: 300 })).rows).toHaveLength(3);
    await expect(coveragePage({ offset: -1 })).rejects.toThrow();
  });

  it('persists repeated worker failure and clears it only after a successful iteration', async () => {
    const id = randomUUID();
    await workerHeartbeat(id);
    await workerFailure(id);
    await workerFailure(id);
    const [failed] = await connection()`select value from host.settings where key='worker'`;
    expect(failed.value).toMatchObject({ state: 'failed', consecutiveFailures: 2 });
    expect(failed.value.lastSuccess).toBeTruthy();
    await workerHeartbeat(id);
    const [healthy] = await connection()`select value from host.settings where key='worker'`;
    expect(healthy.value).toMatchObject({ state: 'healthy', consecutiveFailures: 0 });
    await connection()`delete from host.settings where key='worker'`;
  });
});
