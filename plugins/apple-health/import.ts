import { randomUUID } from 'node:crypto';
import {
  activitySchema,
  canLinkSport,
  type Activity,
  type EntityChange,
  type Workout,
} from '@athlete-panel/contracts';
import { loadProfile, loadWorkspace, persistChanges } from '../../instance/services';
import { persistAndAudit } from '../../instance/commit';
import { canonical } from '../../packages/host/src/crypto';
import type { Transaction } from '../../packages/host/src/db';
import {
  appleActivitiesById,
  removeActivityRoutes,
  saveActivityRoute,
  type StoredAppleActivity,
} from '../activity-records/public/server';
import { reconcileImportedCompletion } from '../training/public/server';
import { normalizeWorkout } from './normalize';
import type { WorkoutBatch } from './protocol';
import {
  identities,
  saveIdentities,
  updateImportStatus,
  type BatchResult,
  type WorkoutIdentity,
} from './repository';

export async function persistRetractions(
  tx: Transaction,
  activities: Activity[],
  reason: 'deleted' | 'excluded',
  planned: ReadonlyMap<string, Workout>,
) {
  if (!activities.length) return;
  const linked = activities.flatMap((activity) => {
    const workout = planned.get(activity.id);
    const change = workout ? reconcileImportedCompletion(workout, null) : null;
    return change ? [change] : [];
  });
  if (linked.length)
    await persistAndAudit(
      tx,
      linked,
      reason === 'deleted'
        ? 'Apple Health deleted an activity. Returned linked sessions to planned.'
        : 'Apple Health source excluded. Returned linked sessions to planned.',
      'system',
    );
  await persistChanges(
    activities.map((activity) => ({
      entity: 'activity',
      id: activity.id,
      before: activity,
      after: null,
    })),
    tx,
  );
  await removeActivityRoutes(
    tx,
    activities.map((activity) => activity.id),
  );
}

export function linkedWorkouts(workouts: readonly Workout[]) {
  const linked = new Map<string, Workout>();
  for (const workout of workouts)
    if (workout.completion?.activityId) linked.set(workout.completion.activityId, workout);
  return linked;
}

type NormalizedWorkout = NonNullable<ReturnType<typeof normalizeWorkout>>;

function updateActivity(workout: NormalizedWorkout, id: string, previous?: StoredAppleActivity) {
  const active = previous?.deleted === false ? previous.activity : null;
  const facts = { ...workout.facts };
  if (previous?.activity.startedAt === facts.startedAt && facts.dateSource === 'inferred') {
    facts.localDate = previous.activity.localDate;
    facts.dateSource = previous.activity.dateSource;
  }
  if (!workout.route && active?.appleHealth?.routeAvailable)
    facts.appleHealth = {
      ...facts.appleHealth,
      routeAvailable: true,
      estimatedElevationMeters: active.appleHealth.estimatedElevationMeters,
    };
  return activitySchema.parse({
    ...facts,
    id,
    revision: active?.revision ?? (previous ? previous.revision + 1 : 1),
  });
}

function batchIssues(result: BatchResult, issue: string) {
  result.issueCount++;
  if (result.issues.length < 10) result.issues.push(issue);
}

function receivedWorkouts(batch: WorkoutBatch, zone: string, report: BatchResult) {
  const workouts = new Map<string, { workout: NormalizedWorkout; index: number }>();
  for (const [index, raw] of batch.allenamenti.entries()) {
    const workout = normalizeWorkout(raw, zone);
    if (workout) workouts.set(workout.uuid, { workout, index });
    else batchIssues(report, `Workout ${index + 1} has an invalid ID, sport, or date.`);
  }
  return workouts;
}

async function observeSources(tx: Transaction, names: string[]) {
  if (names.length)
    await tx`insert into apple_health.sources ${tx(
      names.map((name) => ({ name })),
      'name',
    )}
      on conflict(name) do nothing`;
  const rows = await tx<{ name: string }[]>`select name from apple_health.sources where excluded`;
  return new Set(rows.map((row) => row.name));
}

function stageWorkoutUpdates(
  workouts: ReturnType<typeof receivedWorkouts>,
  deleted: ReadonlySet<string>,
  sentAt: Date,
  previousRecords: {
    existing: ReadonlyMap<string, WorkoutIdentity>;
    stored: ReadonlyMap<string, StoredAppleActivity>;
    linked: ReadonlyMap<string, Workout>;
    excludedSources: ReadonlySet<string>;
  },
  report: BatchResult,
) {
  const { existing, stored, linked, excludedSources } = previousRecords;
  const changed: EntityChange[] = [];
  const touched: WorkoutIdentity[] = [];
  const retracted: Activity[] = [];
  const tracks: { id: string; gpx: string }[] = [];
  const dates: string[] = [];
  for (const [uuid, { workout, index }] of workouts) {
    const identity = existing.get(uuid);
    if (deleted.has(uuid) || identity?.deleted || (identity && identity.sent_at > sentAt)) continue;
    if (excludedSources.has(workout.facts.appleHealth.recordingSource)) {
      report.excluded++;
      // A corrected source label may put a previously visible activity in an excluded source.
      const prior = identity ? stored.get(identity.activity_id) : null;
      if (prior && !prior.deleted) retracted.push(prior.activity);
      if (identity) touched.push({ ...identity, sent_at: sentAt });
      continue;
    }
    const id = identity?.activity_id ?? randomUUID();
    const previous = stored.get(id);
    const before = previous?.deleted === false ? previous.activity : null;
    const next = updateActivity(workout, id, previous);
    const planned = linked.get(id);
    if (planned && !canLinkSport(planned, next)) {
      batchIssues(
        report,
        `Workout ${index + 1} changed sport. Unlink the planned workout and resend history from the iPhone.`,
      );
      continue;
    }
    if (workout.invalidRoute)
      batchIssues(
        report,
        `Workout ${index + 1} had an invalid or oversized GPS route. The workout summary is available.`,
      );
    dates.push(next.localDate);
    touched.push({ uuid, activity_id: id, sent_at: sentAt, deleted: false });
    if (workout.route) tracks.push({ id, gpx: workout.route.gpx });
    if (before && canonical(before) === canonical(next)) continue;
    const after = before ? { ...next, revision: before.revision + 1 } : next;
    changed.push({ entity: 'activity', id, before, after });
    if (planned) {
      const correction = reconcileImportedCompletion(planned, after);
      if (correction) changed.push(correction);
    }
    report.imported++;
  }

  return { changed, touched, retracted, tracks, dates };
}

export async function importWorkouts(tx: Transaction, batch: WorkoutBatch) {
  if (!batch.allenamenti.length && !batch.eliminati.length) return;
  const report: BatchResult = { imported: 0, removed: 0, excluded: 0, issues: [], issueCount: 0 };
  const sentAt = new Date(batch.inviato);
  const workouts = receivedWorkouts(batch, (await loadProfile(tx))?.timezone ?? 'UTC', report);
  const deleted = new Set(batch.eliminati);
  const existing = await identities(tx, [...new Set([...workouts.keys(), ...deleted])]);
  const stored = await appleActivitiesById(
    tx,
    [...existing.values()].map((row) => row.activity_id),
  );
  // Only load the linked records in the workspace. Backfill is not a full activity-history read.
  const state = await loadWorkspace(tx, undefined, { records: 'linked' });
  const linked = linkedWorkouts(state.workouts);
  const excludedSources = await observeSources(tx, [
    ...new Set(
      [...workouts.values()].map(({ workout }) => workout.facts.appleHealth.recordingSource),
    ),
  ]);
  const { changed, touched, retracted, tracks, dates } = stageWorkoutUpdates(
    workouts,
    deleted,
    sentAt,
    { existing, stored, linked, excludedSources },
    report,
  );

  const removed: Activity[] = [];
  for (const uuid of deleted) {
    const identity = existing.get(uuid);
    // Deletion notices can cover non-workout samples. Record only known workout IDs.
    if (identity?.deleted || (!identity && !workouts.has(uuid))) continue;
    const id = identity?.activity_id ?? randomUUID();
    const previous = stored.get(id);
    if (previous && !previous.deleted) removed.push(previous.activity);
    touched.push({ uuid, activity_id: id, sent_at: sentAt, deleted: true });
  }
  report.removed = removed.length;
  await persistRetractions(tx, retracted, 'excluded', linked);
  await persistRetractions(tx, removed, 'deleted', linked);
  if (changed.length) await persistChanges(changed, tx);
  for (const { id, gpx } of tracks) await saveActivityRoute(tx, id, gpx);
  await saveIdentities(tx, touched);
  // Validate linked corrections and removals as one final domain state before acknowledging.
  if (changed.length || removed.length || retracted.length)
    await loadWorkspace(tx, undefined, { records: 'linked' });
  dates.sort();
  await updateImportStatus(tx, report, dates[0] ?? null, dates.at(-1) ?? null);
}
