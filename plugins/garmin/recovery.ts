import { z } from 'zod';
import {
  importStreamSchema,
  recoveryStatusSchema,
  type RecoveryStatus,
  type ImportStream,
  type CoverageRow,
} from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
import { enqueue, type Job } from '../../packages/host/src/jobs';
import { canonical } from '../../packages/host/src/crypto';
import {
  addDays,
  requestCoverageIdentity,
  parseSyncCursor,
  type GarminSyncCursor,
  type SyncCoverage,
} from './sync';
import {
  RECOVERY_STREAMS,
  RECONCILE_INTERVAL,
  healthBucket,
  windowCursor,
  nextGap,
  nextReconciliation,
  uncovered,
  type RecoveryContext,
  type SuccessfulRange,
  type DateRange,
} from './recovery-policy';

export const recoveryTaskSchema = z.object({
  mode: z.enum(['catchup', 'reconcile']),
  stream: importStreamSchema,
});
export type RecoveryTask = z.infer<typeof recoveryTaskSchema>;
type StreamState = {
  stream: ImportStream;
  reconcile_cursor: unknown;
  unavailable: boolean;
  needs_retry: boolean;
  last_scheduled_at: Date | null;
};
type ScheduleState = { next_reconcile_at: Date; blocked_until: Date | null };

async function initialize(tx: Transaction) {
  await tx`insert into garmin.scheduler(id) values(true) on conflict do nothing`;
  await tx`insert into garmin.scan_state ${tx(
    RECOVERY_STREAMS.map((stream) => ({ stream })),
    'stream',
  )} on conflict do nothing`;
}
export async function successfulRanges(tx: Transaction): Promise<SuccessfulRange[]> {
  return tx<
    SuccessfulRange[]
  >`select stream,lower(span)::text as "from",(upper(span)-1)::text as "to" from
    (select stream,unnest(range_agg(daterange(start_date,end_date+1,'[)'))) as span from garmin.coverage where scanned_at is not null group by stream) ranges order by stream,lower(span)`;
}

async function queue(
  tx: Transaction,
  kind: string,
  cursor: GarminSyncCursor,
  context: RecoveryContext,
  task: RecoveryTask,
  priority: number,
) {
  const [live] =
    await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status in ('queued','running','paused','disabled')`;
  if (live) return false;
  const payload = { cursor, generation: context.generation, recovery: task };
  // Background slots are reused only after successful completion; failed checkpoints stay inspectable.
  const [finished] = await tx<
    { id: string }[]
  >`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='completed' order by updated_at desc limit 1`;
  if (finished)
    await tx`update host.jobs set payload=${tx.json(payload as never)},progress='{}',status='queued',priority=${priority},attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now(),created_at=now(),updated_at=now() where id=${finished.id}`;
  else await enqueue(tx, 'garmin', kind, payload, priority);
  await tx`update garmin.scan_state set last_scheduled_at=now() where stream=${task.stream}`;
  return true;
}

export async function scheduleRecovery(tx: Transaction, context: RecoveryContext) {
  await initialize(tx);
  const failures = await tx<
    { payload: { cursor: unknown; recovery: { stream: ImportStream } } }[]
  >`select j.payload from host.jobs j join garmin.scan_state s on s.stream=j.payload#>>'{recovery,stream}' where j.plugin_id='garmin' and j.kind in ('garmin-catchup','garmin-reconcile') and j.status='failed' and not s.needs_retry`;
  for (const failure of failures) {
    try {
      const window = requestCoverageIdentity(parseSyncCursor(failure.payload.cursor));
      await tx`insert into garmin.coverage(stream,start_date,end_date,status,error,scan_state) values(${window.stream},${window.from ?? '0001-01-01'},${window.to},'failed','worker_checkpoint_failed','failed') on conflict(stream,start_date,end_date) do update set status='failed',scan_state='failed',error='worker_checkpoint_failed',updated_at=now()`;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'GarminError') throw error;
      // Invalid checkpoints have no trustworthy date window; the job itself remains visible.
    }
  }
  await tx`update garmin.scan_state s set needs_retry=true from host.jobs j where j.plugin_id='garmin' and j.kind in ('garmin-catchup','garmin-reconcile') and j.status='failed' and j.payload#>>'{recovery,stream}'=s.stream`;
  const [timing] = await tx<ScheduleState[]>`select * from garmin.scheduler where id=true`;
  if (timing?.blocked_until && timing.blocked_until.getTime() > Date.now()) return;
  const states = await tx<
    StreamState[]
  >`select * from garmin.scan_state order by last_scheduled_at nulls first,stream`;
  const ranges = await successfulRanges(tx);
  const planned = await tx<
    { payload: { cursor: unknown } }[]
  >`select payload from host.jobs where plugin_id='garmin' and kind='garmin-history' and status in ('queued','running','paused','disabled')`;
  const cursors = planned.map((row) => parseSyncCursor(row.payload.cursor));
  for (const state of states) {
    if (state.unavailable || state.needs_retry) continue;
    const pending: DateRange[] = cursors
      .filter((cursor) => !cursor.targetStream || cursor.targetStream === state.stream)
      .map((cursor) => ({
        from:
          state.stream === 'activities'
            ? (cursor.activityFrom ?? '0001-01-01')
            : cursor.earliestHealthDate,
        to: cursor.today,
      }));
    const gap = nextGap(state.stream, context, ranges, pending);
    if (
      gap &&
      (await queue(
        tx,
        'garmin-catchup',
        windowCursor(state.stream, gap, context),
        context,
        { mode: 'catchup', stream: state.stream },
        20,
      ))
    )
      break;
  }
  // Initial/repair/catch-up work is processed before periodic rescans, including while it backs off.
  const [foreground] =
    await tx`select id from host.jobs where plugin_id='garmin' and kind in ('garmin-history','garmin-catchup') and status in ('queued','running','paused','disabled') limit 1`;
  if (foreground || (timing && timing.next_reconcile_at.getTime() > Date.now())) return;
  for (const state of states) {
    if (state.unavailable || state.needs_retry) continue;
    const end = addDays(context.today, -7);
    if (end < context.earliestDate) continue;
    const cursor = state.reconcile_cursor
      ? parseSyncCursor(state.reconcile_cursor)
      : windowCursor(
          state.stream,
          state.stream === 'activities'
            ? { from: '0001-01-01', to: end }
            : healthBucket(context.earliestDate, end),
          context,
        );
    if (
      await queue(
        tx,
        'garmin-reconcile',
        cursor,
        context,
        { mode: 'reconcile', stream: state.stream },
        0,
      )
    )
      break;
  }
}

/** Reserve pacing before any provider call; a restart cannot spend accumulated scan credit. */
export async function beginStep(tx: Transaction, job: Job, task?: RecoveryTask) {
  await initialize(tx);
  const [lease] = await tx<
    { payload: unknown }[]
  >`select payload from host.jobs where id=${job.id} and status='running' and lease_owner=${job.lease_owner} and lease_until>now() for update`;
  if (!lease) return false;
  if (canonical(lease.payload) !== canonical(job.payload)) {
    await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null where id=${job.id}`;
    return false;
  }
  const [state] = await tx<
    ScheduleState[]
  >`select * from garmin.scheduler where id=true for update`;
  const due = Math.max(
    state?.blocked_until?.getTime() ?? 0,
    task?.mode === 'reconcile' ? (state?.next_reconcile_at.getTime() ?? 0) : 0,
  );
  if (due > Date.now()) {
    await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=${new Date(due)} where id=${job.id}`;
    return false;
  }
  if (task?.mode === 'reconcile')
    await tx`update garmin.scheduler set next_reconcile_at=${new Date(Date.now() + RECONCILE_INTERVAL)} where id=true`;
  return true;
}

export async function recordRecoveryStep(
  tx: Transaction,
  cursor: GarminSyncCursor,
  next: GarminSyncCursor,
  coverage: SyncCoverage,
  context: RecoveryContext,
  task?: RecoveryTask,
) {
  if (coverage.stream === 'identity') return;
  const stream = importStreamSchema.parse(coverage.stream);
  if (coverage.scanState === 'unavailable')
    await tx`update garmin.scan_state set unavailable=true,updated_at=now() where stream=${stream}`;
  else if (coverage.scanState === 'scanned' && cursor.mode === 'recent')
    await tx`update garmin.scan_state set unavailable=false,updated_at=now() where stream=${stream}`;
  if (task?.mode === 'reconcile') {
    const pending = nextReconciliation(cursor, next, context);
    await tx`update garmin.scan_state set reconcile_cursor=${pending ? tx.json(pending as never) : null},updated_at=now() where stream=${stream}`;
  }
}

export async function recordRecoveryFailure(
  tx: Transaction,
  task: RecoveryTask | undefined,
  retry: boolean,
  backoff: number | null,
) {
  if (backoff !== null)
    await tx`update garmin.scheduler set blocked_until=greatest(coalesce(blocked_until,now()),${new Date(Date.now() + backoff)}) where id=true`;
  if (task && !retry)
    await tx`update garmin.scan_state set needs_retry=true,updated_at=now() where stream=${task.stream}`;
}
export async function clearRecoveryFailures(tx: Transaction, stream?: ImportStream) {
  await tx`update garmin.scan_state set needs_retry=false where (${stream ?? null}::text is null or stream=${stream ?? null})`;
  await tx`update host.jobs set status='cancelled',lease_owner=null,lease_until=null where plugin_id='garmin' and kind in ('garmin-catchup','garmin-reconcile') and status='failed' and (${stream ?? null}::text is null or payload#>>'{recovery,stream}'=${stream ?? null})`;
}

export async function unscannedCoverage(
  tx: Transaction,
  context: Pick<RecoveryContext, 'today' | 'earliestDate'>,
): Promise<CoverageRow[]> {
  const ranges = await successfulRanges(tx);
  return RECOVERY_STREAMS.flatMap((stream) =>
    uncovered(
      stream === 'activities' ? '0001-01-01' : context.earliestDate,
      context.today,
      ranges.filter((row) => row.stream === stream),
    )
      .flatMap((range) => {
        if (stream === 'activities') return [range];
        const windows: DateRange[] = [];
        let end = range.to;
        while (end >= range.from) {
          const bucket = healthBucket(context.earliestDate, end);
          const from = bucket.from < range.from ? range.from : bucket.from;
          windows.push({ from, to: end });
          if (from === range.from) break;
          end = addDays(from, -1);
        }
        return windows;
      })
      .map((range) => ({
        stream,
        ...range,
        status: 'unscanned',
        scanState: 'unscanned' as const,
        lastScannedAt: null,
        records: 0,
        missingDays: 0,
        unknownMetrics: 0,
        error: null,
        rejectedRecords: 0,
        diagnostics: [],
      })),
  ).sort((a, b) => (a.to > b.to ? -1 : a.to < b.to ? 1 : a.stream < b.stream ? -1 : 1));
}

export async function recoveryStatus(
  tx: Transaction,
  context: Pick<RecoveryContext, 'today' | 'earliestDate'>,
): Promise<RecoveryStatus> {
  const jobs = await tx<
    { kind: string; status: string; payload: { cursor: unknown }; next_run_at: Date }[]
  >`select distinct on (kind) kind,status,payload,next_run_at from host.jobs where plugin_id='garmin' and kind in ('garmin-catchup','garmin-reconcile') order by kind,case when status in ('queued','running','paused','disabled') then 0 else 1 end,created_at desc`;
  const project = (kind: string) => {
    const job = jobs.find((row) => row.kind === kind);
    if (!job) return null;
    let range: { stream: ImportStream | null; from: string | null; to: string | null } = {
      stream: null,
      from: null,
      to: null,
    };
    try {
      const window = requestCoverageIdentity(parseSyncCursor(job.payload.cursor));
      const stream = importStreamSchema.safeParse(window.stream);
      range = { stream: stream.success ? stream.data : null, from: window.from, to: window.to };
    } catch {
      /* Damaged checkpoints are labelled by job status without exposing stored values. */
    }
    return { ...range, status: job.status, nextRunAt: job.next_run_at?.toISOString() ?? null };
  };
  const [schedule] = await tx<ScheduleState[]>`select * from garmin.scheduler where id=true`;
  const failures = await tx<
    { stream: ImportStream }[]
  >`select stream from garmin.scan_state where needs_retry=true order by stream`;
  return recoveryStatusSchema.parse({
    catchup: project('garmin-catchup'),
    reconciliation: project('garmin-reconcile'),
    nextReconcileAt: schedule?.next_reconcile_at.toISOString() ?? null,
    unscannedWindows: (await unscannedCoverage(tx, context)).length,
    retryStreams: failures.map((row) => row.stream),
  });
}
