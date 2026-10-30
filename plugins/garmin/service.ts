import { garminStatusSchema, operationContracts } from '@athlete-panel/contracts';
import { importStreamSchema } from '@athlete-panel/contracts';
import { coverageDto, persistCoverage, resumeActivityScan, type StoredCoverage } from './coverage';
import { requiredRow } from '../../packages/host/src/rows';
import { connectionMessage } from './connection-status';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  dateSchema,
  activitySchema,
  healthRecordSchema,
  type EntityChange,
} from '../../packages/contracts/src';
import { connection, transaction, type Transaction } from '../../packages/host/src/db';
import { encrypt, decrypt, canonical, digest } from '../../packages/host/src/crypto';
import { idempotent } from '../../packages/host/src/idempotency';
import { assert } from '../../packages/host/src/errors';
import { enqueue, MAX_JOB_ATTEMPTS, retryDelay, type Job } from '../../packages/host/src/jobs';
import {
  loadWorkspace,
  loadProfile,
  persistChanges,
  type WorkspaceLoadOptions,
} from '../../instance/services';
import { createGarminClient, GarminError, type CachedGarminToken } from './transport';
import {
  createSyncCursor,
  runSyncStep,
  getAccountIdentity,
  requestCoverageIdentity,
  type GarminSyncCursor,
  parseSyncCursor,
  syncScope,
  importsStream,
} from './sync';
import { assertAccountBinding, streamMetrics, type HealthStream } from './normalize';
import { automaticHealthHistoryStart } from './history-policy';
import {
  scheduleRecovery,
  recoveryStatus,
  beginStep,
  recordRecoveryStep,
  recordRecoveryFailure,
  clearRecoveryFailures,
  unscannedCoverage,
  recoveryTaskSchema,
  type RecoveryTask,
  retireReconciliation,
} from './recovery';
import { RECOVERY_STREAMS } from './recovery-policy';

const configurationSchema = z.object({
  lastErrorCode: z.string().nullable().optional(),
  verifiedGeneration: z.string().optional(),
  encryptedKey: z.string().optional(),
  generation: z.string(),
  earliestDate: dateSchema,
  accountId: z.string().nullable(),
  paused: z.boolean(),
  lastSync: z.string().nullable(),
  lastError: z.string().nullable(),
});
type Configuration = z.infer<typeof configurationSchema>;
export async function getConfiguration(
  tx = connection() as unknown as Transaction,
): Promise<Configuration | null> {
  const [row] = await tx<{ value: unknown }[]>`select value from host.settings where key='garmin'`;
  return row ? configurationSchema.parse(row.value) : null;
}
async function saveConfig(tx: Transaction, config: Configuration) {
  await tx`insert into host.settings(key,value) values('garmin',${tx.json(config)}) on conflict(key) do update set value=excluded.value`;
}
function today(timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export async function configure(body: unknown) {
  const input = z
    .object({
      key: z.string().trim().min(8).max(4096),
      earliestDate: dateSchema.optional(),
      idempotencyKey: z.uuid().optional(),
    })
    .strict()
    .parse(body);
  // Accept the old field from a stale client, but never let it restrict automatic history.
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey ?? randomUUID(),
      { operation: 'garmin.configure', keyDigest: digest(input.key) },
      async () => {
        const old = await getConfiguration(tx),
          profile = await loadProfile(tx);
        const config: Configuration = {
          ...old,
          generation: randomUUID(),
          encryptedKey: encrypt(input.key),
          earliestDate: automaticHealthHistoryStart(old?.earliestDate),
          accountId: old?.accountId ?? null,
          paused: false,
          lastSync: old?.lastSync ?? null,
          lastError: null,
          lastErrorCode: null,
        };
        await saveConfig(tx, config);
        await clearRecoveryFailures(tx);
        await tx`delete from host.settings where key='garminToken'`;
        // Preserve existing checkpoints, but re-verify account binding before resuming imports.
        await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now(),error=null where plugin_id='garmin' and status in ('paused','running')`;
        for (const kind of ['garmin-recent', 'garmin-history']) {
          const active =
            await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='queued'`;
          if (!active.length) {
            const [failed] =
              await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='failed' order by created_at desc limit 1`;
            if (failed)
              await tx`update host.jobs set status='queued',attempts=0,error=null,next_run_at=now() where id=${failed.id}`;
          }
        }
        await tx`update host.jobs set payload=jsonb_set(payload,'{cursor,earliestHealthDate}',to_jsonb(${config.earliestDate}::text))
      where plugin_id='garmin' and kind='garmin-history' and status='queued' and payload#>>'{cursor,activityFrom}' is null and payload#>>'{cursor,earliestHealthDate}'>${config.earliestDate}`;
        await enqueue(
          tx,
          'garmin',
          'garmin-history',
          {
            cursor: createSyncCursor({
              today: today(profile?.timezone),
              earliestHealthDate: config.earliestDate,
              accountId: config.accountId,
              timeZone: profile?.timezone,
            }),
            generation: config.generation,
          },
          10,
        );
        return { connected: true };
      },
    ),
  );
}
export async function sync(body: unknown) {
  const input = operationContracts.garmin.sync.input.parse(body);
  return transaction(async (tx) => {
    const config = await getConfiguration(tx);
    assert(config?.encryptedKey, 'disconnected', 'Configure a Garmin key first.');
    assert(!config.paused, 'paused', 'Resume Garmin import first.');
    const profile = await loadProfile(tx),
      end = input.to ?? today(profile?.timezone);
    assert(!input.to || input.from, 'invalid_range', 'A targeted reimport requires both dates.');
    const targeted = !!(input.from && input.to),
      automaticStart = automaticHealthHistoryStart(config.earliestDate);
    assert(
      !input.scope || (targeted && input.mode === 'full' && !input.stream),
      'invalid_range',
      'Choose a refresh scope with both dates, without a stream retry.',
    );
    assert(
      !input.stream || (targeted && input.mode === 'full'),
      'invalid_range',
      'A stream retry requires a full import with both dates.',
    );
    assert(
      !input.stream ||
        input.stream === 'activities' ||
        (Date.parse(end) - Date.parse(input.from!)) / 86400000 < 28,
      'invalid_range',
      'A health stream retry supports at most 28 days.',
    );
    if (config.earliestDate !== automaticStart)
      await saveConfig(tx, { ...config, earliestDate: automaticStart });
    const cursor = createSyncCursor({
      today: end,
      earliestHealthDate: targeted ? input.from! : automaticStart,
      mode: input.mode === 'full' ? 'initial' : 'recent',
      accountId: config.accountId,
      timeZone: profile?.timezone,
      ...(targeted && input.from !== '0001-01-01' ? { activityFrom: input.from! } : {}),
      ...(input.stream ? { targetStream: input.stream } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
    });
    if (input.mode === 'full')
      await clearRecoveryFailures(
        tx,
        RECOVERY_STREAMS.filter((stream) => importsStream(cursor, stream)),
      );
    const kind = input.mode === 'full' ? 'garmin-history' : 'garmin-recent';
    // Expand an old automatic backfill in place. Explicit range repairs keep their own bounds.
    if (input.mode === 'full' && !targeted)
      await tx`update host.jobs set payload=jsonb_set(payload,'{cursor,earliestHealthDate}',to_jsonb(${automaticStart}::text))
      where plugin_id='garmin' and kind='garmin-history' and status in ('queued','running','paused','failed')
      and payload#>>'{cursor,activityFrom}' is null and payload#>>'{cursor,earliestHealthDate}'>${automaticStart}`;
    const exactEnd = targeted || input.mode === 'recent';
    const matching = (saved: GarminSyncCursor) =>
      saved?.mode === cursor.mode &&
      saved.earliestHealthDate === cursor.earliestHealthDate &&
      (saved.activityFrom ?? null) === (cursor.activityFrom ?? null) &&
      saved.targetStream === cursor.targetStream &&
      (saved.scope ?? 'both') === (cursor.scope ?? 'both') &&
      (!exactEnd || saved.today === cursor.today);
    const active =
      await tx`select id,status,payload from host.jobs where plugin_id='garmin' and kind=${kind} and status in ('queued','running','paused','disabled') order by created_at desc`;
    const activeJob = active[0];
    if (activeJob) {
      assert(
        active.every((job) => matching(job.payload.cursor)),
        'import_busy',
        'Finish or cancel the current import before requesting a different range.',
        409,
      );
      return { id: activeJob.id, status: activeJob.status };
    }
    const [failed] =
      await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='failed'
      and payload#>>'{cursor,mode}'=${cursor.mode} and payload#>>'{cursor,earliestHealthDate}'=${cursor.earliestHealthDate}
      and coalesce(payload#>>'{cursor,activityFrom}','')=${cursor.activityFrom ?? ''}
      and coalesce(payload#>>'{cursor,targetStream}','')=${cursor.targetStream ?? ''}
      and coalesce(payload#>>'{cursor,scope}','both')=${cursor.scope ?? 'both'}
      and (${!exactEnd} or payload#>>'{cursor,today}'=${cursor.today}) order by updated_at desc,created_at desc limit 1`;
    if (failed) {
      await tx`update host.jobs set status='queued',attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now(),updated_at=now() where id=${failed.id}`;
      return { id: failed.id, status: 'queued' };
    }
    const id = await enqueue(
      tx,
      'garmin',
      kind,
      { cursor, generation: config.generation },
      input.mode === 'recent' ? 30 : targeted ? 20 : 10,
    );
    return { id, status: 'queued' };
  });
}
export async function pause(body: unknown) {
  const { paused } = z.object({ paused: z.boolean() }).strict().parse(body);
  await transaction(async (tx) => {
    const config = await getConfiguration(tx);
    assert(config, 'disconnected', 'Configure Garmin first.');
    await saveConfig(tx, { ...config, paused });
    if (paused)
      await tx`update host.jobs set status='paused',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running')`;
    else
      await tx`update host.jobs set status='queued',next_run_at=now(),lease_owner=null,lease_until=null where plugin_id='garmin' and status='paused'`;
  });
  return { paused };
}
export async function disconnect() {
  await transaction(async (tx) => {
    const config = await getConfiguration(tx);
    if (config) {
      const { encryptedKey: _encryptedKey, ...rest } = config;
      await saveConfig(tx, { ...rest, paused: true, generation: randomUUID() });
    }
    await tx`delete from host.settings where key='garminToken'`;
    await tx`update host.jobs set status='cancelled',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running','paused')`;
  });
  return { connected: false };
}
export async function status(includeCoverage = true) {
  const config = await getConfiguration(),
    sql = connection();
  const coverage = includeCoverage
    ? await sql<
        StoredCoverage[]
      >`select stream,start_date::text as "from",end_date::text as "to",status,records,missing_days as "missingDays",unknown_metrics as "unknownMetrics",error,scan_state as "scanState",scanned_at as "lastScannedAt",rejected_records as "rejectedRecords",diagnostics from garmin.coverage order by end_date desc,stream,start_date desc limit 300`
    : [];
  const counts = requiredRow(
    await sql<
      {
        windows: number;
        failed: number;
        complete: number;
        empty: number;
        unavailable: number;
        rejected: number;
      }[]
    >`select count(*)::int as windows, count(*) filter(where status='failed')::int as failed, count(*) filter(where status='complete')::int as complete, count(*) filter(where status='no-data')::int as empty, count(*) filter(where status='unavailable')::int as unavailable, count(*) filter(where rejected_records>0)::int as rejected from garmin.coverage`,
  );
  const jobs = await sql<
    {
      id: string;
      kind: string;
      status: string;
      progress: { label?: string } | null;
      error: string | null;
      next_run_at: Date;
      updated_at: Date;
    }[]
  >`select id,kind,status,progress,error,next_run_at,updated_at from host.jobs where plugin_id='garmin' and kind in ('garmin-history','garmin-recent','garmin-catchup')
    order by case when status in ('queued','running','paused') then 0 else 1 end,priority desc,updated_at desc limit 1`;
  const [history] = await sql<
    { status: string }[]
  >`select status from host.jobs where plugin_id='garmin' and kind='garmin-history' order by created_at desc limit 1`;
  const job = jobs[0];
  const currentJob = job
    ? {
        id: job.id,
        kind: job.kind,
        status: job.status,
        progress: job.progress?.label ?? '',
        nextRunAt: job.next_run_at?.toISOString() ?? null,
        retrying: job.status === 'queued' && !!job.error,
      }
    : null;
  const connected = !!config?.encryptedKey,
    verified = connected && config?.verifiedGeneration === config?.generation;
  const profile = await loadProfile(sql as unknown as Transaction);
  const recovery = await recoveryStatus(sql as unknown as Transaction, {
    today: today(profile?.timezone),
    earliestDate: automaticHealthHistoryStart(config?.earliestDate),
  });
  const result = {
    recovery,
    connected,
    verified,
    lastErrorCode: config?.lastErrorCode ?? null,
    currentJob,
    historyStatus: history?.status ?? null,
    checkedAt: new Date().toISOString(),
    paused: config?.paused ?? false,
    earliestDate: config?.earliestDate ?? null,
    lastSync: config?.lastSync ?? null,
    lastError: config?.lastError ?? null,
    status: !connected
      ? 'Disconnected'
      : config?.lastError
        ? 'Import needs attention'
        : config?.paused
          ? 'Paused'
          : verified
            ? 'Account verified'
            : 'Key saved — waiting for verification',
    coverage: coverage.map(coverageDto),
    coverageSummary: {
      windows: counts.windows,
      failed: counts.failed,
      complete: counts.complete,
      empty: counts.empty,
      unavailable: counts.unavailable,
      rejected: counts.rejected,
    },
  };
  return garminStatusSchema.parse({ ...result, status: connectionMessage(result) });
}

export async function coveragePage(body: unknown) {
  const input = z
    .object({
      filter: z.enum(['all', 'failed', 'unavailable', 'rejected', 'unscanned']).default('all'),
      offset: z.number().int().min(0).max(1000000).default(0),
    })
    .strict()
    .parse(body);
  const sql = connection();
  if (input.filter === 'unscanned') {
    const config = await getConfiguration(),
      profile = await loadProfile(sql as unknown as Transaction);
    const rows = config
      ? await unscannedCoverage(sql as unknown as Transaction, {
          today: today(profile?.timezone),
          earliestDate: automaticHealthHistoryStart(config.earliestDate),
        })
      : [];
    return {
      rows: rows.slice(input.offset, input.offset + 50),
      total: rows.length,
      offset: input.offset,
      limit: 50,
    };
  }
  const count = requiredRow(
    await sql<
      { total: number }[]
    >`select count(*)::int as total from garmin.coverage where (${input.filter}='all' or status=${input.filter} or (${input.filter}='rejected' and rejected_records>0))`,
  );
  const rows = await sql<
    StoredCoverage[]
  >`select stream,start_date::text as "from",end_date::text as "to",status,records,missing_days as "missingDays",unknown_metrics as "unknownMetrics",error,scan_state as "scanState",scanned_at as "lastScannedAt",rejected_records as "rejectedRecords",diagnostics from garmin.coverage where (${input.filter}='all' or status=${input.filter} or (${input.filter}='rejected' and rejected_records>0)) order by end_date desc,stream,start_date desc limit 50 offset ${input.offset}`;
  return { rows: rows.map(coverageDto), total: count.total, offset: input.offset, limit: 50 };
}
export async function scheduleRecent() {
  await transaction(async (tx) => {
    await retireReconciliation(tx);
    const config = await getConfiguration(tx);
    if (!config?.encryptedKey || config.paused) return;
    await tx`update host.jobs set priority=case when kind='garmin-recent' then 30 when payload#>>'{cursor,activityFrom}' is not null then 20 else 10 end where plugin_id='garmin' and kind in ('garmin-recent','garmin-history') and status in ('queued','running','paused','disabled')`;
    const [last] =
      await tx`select created_at,status from host.jobs where plugin_id='garmin' and kind='garmin-recent' order by created_at desc limit 1`;
    const profile = await loadProfile(tx);
    if (
      last?.status !== 'failed' &&
      (!last || Date.now() - new Date(last.created_at).getTime() >= 60 * 60 * 1000)
    )
      await enqueue(
        tx,
        'garmin',
        'garmin-recent',
        {
          cursor: createSyncCursor({
            today: today(profile?.timezone),
            earliestHealthDate: automaticHealthHistoryStart(config.earliestDate),
            mode: 'recent',
            accountId: config.accountId,
            timeZone: profile?.timezone,
          }),
          generation: config.generation,
        },
        30,
      );
    if (config.accountId && config.verifiedGeneration === config.generation)
      await scheduleRecovery(tx, {
        today: today(profile?.timezone),
        earliestDate: automaticHealthHistoryStart(config.earliestDate),
        accountId: config.accountId,
        generation: config.generation,
        timeZone: profile?.timezone ?? 'UTC',
      });
  });
}

const clients = new Map<string, ReturnType<typeof createGarminClient>>();
function clientFor(config: Configuration) {
  let client = clients.get(config.generation);
  if (client) return client;
  clients.clear();
  client = createGarminClient({
    apiKey: decrypt(config.encryptedKey!),
    credentialGeneration: config.generation,
    tokenCache: {
      async load(generation) {
        const [row] = await connection()`select value from host.settings where key='garminToken'`;
        if (!row || row.value.generation !== generation) return null;
        return JSON.parse(decrypt(row.value.encrypted)) as CachedGarminToken;
      },
      async save(token) {
        await transaction(async (tx) => {
          const current = await getConfiguration(tx);
          if (current?.generation === config.generation)
            await tx`insert into host.settings(key,value) values('garminToken',${tx.json({ generation: config.generation, encrypted: encrypt(JSON.stringify(token)) })}) on conflict(key) do update set value=excluded.value`;
        });
      },
      async clear(generation) {
        await connection()`delete from host.settings where key='garminToken' and value->>'generation'=${generation}`;
      },
    },
  });
  clients.set(config.generation, client);
  return client;
}
export async function runGarminJob(job: Job) {
  if (job.kind === 'garmin-reconcile') {
    await transaction((tx) => retireReconciliation(tx, job));
    return;
  }
  const config = await getConfiguration();
  if (!config?.encryptedKey || config.paused) {
    await transaction(async (tx) => {
      const current = await getConfiguration(tx);
      if (!current?.encryptedKey || current.paused)
        await tx`update host.jobs set status=${current?.encryptedKey ? 'paused' : 'cancelled'},lease_owner=null,lease_until=null where id=${job.id} and status='running' and lease_owner=${job.lease_owner} and lease_until>now()`;
    });
    return;
  }
  let cursor = job.payload.cursor as GarminSyncCursor;
  let coverageCursor = cursor;
  let reverifiedIdentity = false;
  let recovery: RecoveryTask | undefined;
  try {
    cursor = parseSyncCursor(job.payload.cursor);
    recovery =
      job.payload.recovery === undefined
        ? undefined
        : recoveryTaskSchema.parse(job.payload.recovery);
    if (!(await transaction((tx) => beginStep(tx, job)))) return;
    cursor = await resumeActivityScan(connection() as unknown as Transaction, cursor);
    if (job.payload.generation !== config.generation && cursor.phase !== 'identity') {
      coverageCursor = { ...cursor, phase: 'identity' };
      const identity = await getAccountIdentity(clientFor(config), cursor.today, syncScope(cursor));
      assertAccountBinding(config.accountId, [identity]);
      cursor = { ...cursor, accountId: identity };
      reverifiedIdentity = true;
    }
    coverageCursor = cursor;
    const step = await runSyncStep(cursor, clientFor(config));
    await transaction(async (tx) => {
      const current = await getConfiguration(tx),
        [lease] =
          await tx`select status,lease_owner,lease_until,payload from host.jobs where id=${job.id} for update`;
      if (
        current?.generation !== config.generation ||
        current.paused ||
        lease?.status !== 'running' ||
        lease.lease_owner !== job.lease_owner ||
        new Date(lease.lease_until).getTime() <= Date.now()
      )
        return;
      if (canonical(lease.payload) !== canonical(job.payload)) {
        await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now() where id=${job.id}`;
        return;
      }
      assert(
        !current.accountId || current.accountId === step.accountId,
        'account_mismatch',
        'This key belongs to a different Garmin account.',
        409,
      );
      assert(
        step.accountId,
        'account_identity_unavailable',
        'Garmin sync requires a verified account binding.',
        409,
      );
      const selection: WorkspaceLoadOptions = {
        records: 'linked',
        activityExternalIds: step.activities.map(
          (record) => `${step.accountId}:${record.externalId}`,
        ),
        healthExternalIds: step.healthRecords.map(
          (record) => `${step.accountId}:${record.externalId}`,
        ),
      };
      const state = await loadWorkspace(tx, undefined, selection),
        changes: EntityChange[] = [];
      for (const [kind, imports] of [
        ['activity', step.activities],
        ['health', step.healthRecords],
      ] as const) {
        const existing = kind === 'activity' ? state.activities : state.health;
        for (const imported of imports) {
          const externalId = `${step.accountId}:${imported.externalId}`,
            old = existing.find((r) => r.externalId === externalId);
          const next = (kind === 'activity' ? activitySchema : healthRecordSchema).parse({
            ...imported,
            externalId,
            id: old?.id ?? randomUUID(),
            revision: old?.revision ?? 1,
            provenance: {
              sourceAccountId: step.accountId,
              source: step.coverage.stream,
              ...(kind === 'health' &&
              'metric' in imported &&
              imported.metric === 'restingHeartRateBpm'
                ? { restingHeartRateMayBeMinimum: true }
                : {}),
            },
          });
          if (old && canonical(old) === canonical(next)) continue;
          if (old) next.revision++;
          changes.push({ entity: kind, id: next.id, before: old ?? null, after: next });
          if (kind === 'activity')
            for (const workout of state.workouts.filter(
              (w) => w.completion?.activityId === next.id,
            )) {
              const a = activitySchema.parse(next);
              const after = {
                ...workout,
                revision: workout.revision + 1,
                completion: {
                  ...workout.completion!,
                  performedDate: a.localDate,
                  durationSeconds: a.durationSeconds,
                  distanceMeters: a.distanceMeters,
                },
              };
              changes.push({ entity: 'workout', id: workout.id, before: workout, after });
            }
        }
      }
      await persistChanges(changes, tx);
      // Provider corrections must not break existing domain relationships.
      // A conflicting sport correction remains a visible retryable window after owner reconciliation.
      await loadWorkspace(tx, undefined, selection);
      const coverage = step.coverage;
      if (reverifiedIdentity)
        await tx`delete from garmin.coverage where status='failed' and stream='identity' and start_date='0001-01-01' and end_date=${cursor.today}`;
      // Old releases keyed errors by phase and the whole backfill start instead of the actual stream/window.
      await tx`delete from garmin.coverage where status='failed' and stream=${cursor.phase} and start_date<=${coverage.from ?? cursor.earliestHealthDate} and end_date=${cursor.windowEnd}`;
      if (coverage.stream === 'identity')
        await tx`delete from garmin.coverage where status='failed' and stream='identity' and start_date=${coverage.from ?? '0001-01-01'} and end_date=${coverage.to}`;
      await persistCoverage(tx, coverage);
      await recordRecoveryStep(tx, cursor, coverage);
      const done = step.nextCursor.phase === 'done';
      const label = done
        ? 'Import complete'
        : coverage.stream === 'identity'
          ? 'Account verified'
          : `${coverage.stream}: ${coverage.from ?? 'available history'} – ${coverage.to}`;
      await saveConfig(tx, {
        ...current,
        accountId: step.accountId,
        verifiedGeneration: config.generation,
        lastError: null,
        lastErrorCode: null,
        lastSync: done && !recovery ? new Date().toISOString() : current.lastSync,
      });
      await tx`update host.jobs set payload=${tx.json({ cursor: step.nextCursor, generation: config.generation, ...(recovery ? { recovery } : {}) })},progress=${tx.json({ phase: step.nextCursor.phase, stream: coverage.stream, to: coverage.to, label, rejectedRecords: coverage.rejectedRecords })},status=${done ? 'completed' : 'queued'},attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now()+interval '1.1 seconds',updated_at=now() where id=${job.id}`;
    });
  } catch (error) {
    const known = error instanceof GarminError ? error : null;
    const message =
      known?.message ??
      'Import failed validation or persistence. The current window was not committed.';
    const attempts = job.attempts + 1,
      retry = known?.retryable && attempts < MAX_JOB_ATTEMPTS;
    const delay = known?.retryAfterMs ?? retryDelay(attempts) * (0.8 + Math.random() * 0.4);
    await transaction(async (tx) => {
      const current = await getConfiguration(tx),
        [lease] =
          await tx`select status,lease_owner,lease_until,payload from host.jobs where id=${job.id} for update`;
      if (
        current?.generation !== config.generation ||
        current.paused ||
        lease?.status !== 'running' ||
        lease.lease_owner !== job.lease_owner ||
        new Date(lease.lease_until).getTime() <= Date.now()
      )
        return;
      if (canonical(lease.payload) !== canonical(job.payload)) {
        await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now() where id=${job.id}`;
        return;
      }
      await tx`update host.jobs set status=${retry ? 'queued' : 'failed'},attempts=${attempts},error=${message},next_run_at=${new Date(Date.now() + delay)},lease_owner=null,lease_until=null,updated_at=now() where id=${job.id} and lease_owner=${job.lease_owner}`;
      await recordRecoveryFailure(
        tx,
        recovery,
        !!retry,
        known?.retryAfterMs ?? (known?.code === 'rate_limited' ? delay : null),
      );
      await saveConfig(tx, {
        ...current,
        lastError: message,
        lastErrorCode: known?.code ?? 'import_failed',
        paused:
          known?.code === 'credentials_rejected' || known?.code === 'account_mismatch'
            ? true
            : current.paused,
      });
      if (known?.code === 'credentials_rejected' || known?.code === 'account_mismatch')
        await tx`update host.jobs set status='paused',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running')`;
      let coverage: ReturnType<typeof requestCoverageIdentity> | null = null;
      try {
        coverage = requestCoverageIdentity(coverageCursor);
      } catch {
        /* An invalid checkpoint has no trustworthy request window. The job retains its error. */
      }
      if (coverage) {
        if (!retry && importStreamSchema.safeParse(coverage.stream).success)
          await tx`update garmin.scan_state set needs_retry=true,updated_at=now() where stream=${coverage.stream}`;
        const metrics = streamMetrics[coverage.stream as HealthStream];
        const missingDays =
          metrics && coverage.from !== null
            ? Math.max(
                0,
                Math.floor((Date.parse(coverage.to) - Date.parse(coverage.from)) / 86400000) + 1,
              )
            : 0;
        await tx`insert into garmin.coverage(stream,start_date,end_date,status,records,error,missing_days,unknown_metrics,scan_state) values(${coverage.stream},${coverage.from ?? '0001-01-01'},${coverage.to},'failed',0,${message},${missingDays},${missingDays * (metrics?.length ?? 0)},'failed') on conflict(stream,start_date,end_date) do update set status='failed',scan_state='failed',error=excluded.error,missing_days=excluded.missing_days,unknown_metrics=excluded.unknown_metrics,updated_at=now()`;
      }
    });
  }
}
