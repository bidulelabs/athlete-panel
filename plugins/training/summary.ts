import {
  dateSchema,
  isRest,
  isUnresolvedActivitySport,
  canLinkSport,
  type Activity,
  type Completion,
  type Workout,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { addDays, effectiveDate } from './dates';

export type MetricTotal = { value: number | null; knownCount: number; missingCount: number };
export type VolumeSummary = {
  sessions: number;
  durationSeconds: MetricTotal;
  distanceMeters: { cycling: MetricTotal; running: MetricTotal; other: MetricTotal };
};
export type TrainingSummary = {
  startDate: string;
  endDate: string;
  planned: VolumeSummary;
  actual: VolumeSummary & { elevationMeters: { cycling: MetricTotal; running: MetricTotal } };
  sportBreakdown: SportBreakdown[];
  plannedStatus: Record<'completed' | 'partial' | 'skipped' | 'pending', number>;
  recordedSessions: RecordedSession[];
  /** Heuristic prompts for review only; these are never automatically removed from totals. */
  possibleDuplicateWorkoutIds: string[];
};
export type RecordedSession = {
  kind: 'activity' | 'workout';
  id: string;
  title: string;
  sport: string | null;
  sportSubgroup?: string | null;
  sportResolution?: 'resolved' | 'unresolved';
  localDate: string;
  startedAt: string | null;
  durationSeconds: number | null;
};
type Session = {
  sport: string | null;
  sportSubgroup?: string | null;
  sportResolution?: 'resolved' | 'unresolved';
  durationSeconds: number | null;
  distanceMeters: number | null;
};

/** Provider corrections remain authoritative; snapshots in mutation audit stay unchanged. */
export function resolveCompletion(
  workout: Workout,
  activities: readonly Activity[],
): Completion | null {
  const completion = workout.completion;
  if (!completion) return null;
  if (completion.source === 'manual') return { ...completion };
  const activity = activities.find((item) => item.id === completion.activityId);
  if (!activity) return { ...completion };
  return {
    ...completion,
    performedDate: activity.localDate,
    durationSeconds: activity.durationSeconds,
    distanceMeters: activity.distanceMeters,
  };
}

function total(values: Array<number | null>): MetricTotal {
  const known = values.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  );
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : values.length ? null : 0,
    knownCount: known.length,
    missingCount: values.length - known.length,
  };
}

/** A ratio describes known recorded volume, never a target achievement or import guarantee. */
export function comparisonPercent(planned: MetricTotal, actual: MetricTotal): number | null {
  if (
    planned.value === null ||
    planned.value <= 0 ||
    actual.value === null ||
    actual.knownCount === 0 ||
    planned.missingCount ||
    actual.missingCount
  )
    return null;
  return (actual.value / planned.value) * 100;
}

function volume(sessions: Session[]): VolumeSummary {
  return {
    sessions: sessions.length,
    durationSeconds: total(sessions.map((item) => item.durationSeconds)),
    distanceMeters: {
      cycling: total(
        sessions.filter((item) => item.sport === 'cycling').map((item) => item.distanceMeters),
      ),
      running: total(
        sessions.filter((item) => item.sport === 'running').map((item) => item.distanceMeters),
      ),
      other: total(
        sessions
          .filter((item) => item.sport !== 'running' && item.sport !== 'cycling')
          .map((item) => item.distanceMeters),
      ),
    },
  };
}

type SportVolume = {
  sessions: number;
  durationSeconds: MetricTotal;
  distanceMeters: MetricTotal;
  elevationMeters: MetricTotal;
};
export type SportBreakdown = {
  sport: string;
  sportSubgroup: string | null;
  sportResolution: 'resolved' | 'unresolved';
  planned: SportVolume;
  actual: SportVolume;
};
type MeasuredSession = Session & {
  elevationMeters?: number | null;
  plannedElevationGainMeters?: number | null;
};
function sportVolume(items: MeasuredSession[], planned: boolean): SportVolume {
  return {
    sessions: items.length,
    durationSeconds: total(items.map((item) => item.durationSeconds)),
    distanceMeters: total(items.map((item) => item.distanceMeters)),
    elevationMeters: total(
      items.map(
        (item) => (planned ? item.plannedElevationGainMeters : item.elevationMeters) ?? null,
      ),
    ),
  };
}
function breakdown(planned: MeasuredSession[], actual: MeasuredSession[]): SportBreakdown[] {
  const keys = new Map<
    string,
    { sport: string; sportSubgroup: string | null; sportResolution: 'resolved' | 'unresolved' }
  >();
  for (const item of [...planned, ...actual]) {
    if (!item.sport) continue;
    const sportResolution = isUnresolvedActivitySport(item) ? 'unresolved' : 'resolved';
    keys.set(JSON.stringify([item.sport, null, sportResolution]), {
      sport: item.sport,
      sportSubgroup: null,
      sportResolution,
    });
    if (item.sportSubgroup)
      keys.set(JSON.stringify([item.sport, item.sportSubgroup, sportResolution]), {
        sport: item.sport,
        sportSubgroup: item.sportSubgroup,
        sportResolution,
      });
  }
  return [...keys.values()]
    .sort(
      (a, b) =>
        a.sport.localeCompare(b.sport) ||
        (a.sportSubgroup ?? '').localeCompare(b.sportSubgroup ?? ''),
    )
    .map((key) => {
      const matches = (item: MeasuredSession) =>
        item.sport === key.sport &&
        (isUnresolvedActivitySport(item) ? 'unresolved' : 'resolved') === key.sportResolution &&
        (!key.sportSubgroup || item.sportSubgroup === key.sportSubgroup);
      return {
        ...key,
        planned: sportVolume(planned.filter(matches), true),
        actual: sportVolume(actual.filter(matches), false),
      };
    });
}

/** Actual chronology uses performed/provider dates, never the workout's planned date. */
export function summarizeRange(
  state: WorkspaceState,
  range: { startDate: string; endDate: string },
): TrainingSummary {
  dateSchema.parse(range.startDate);
  dateSchema.parse(range.endDate);
  if (range.endDate < range.startDate) throw new Error('End date must not precede start date.');
  const inRange = (date: string | null) =>
    date !== null && date >= range.startDate && date <= range.endDate;
  const planned = state.workouts.filter(
    (workout) => !isRest(workout) && inRange(effectiveDate(workout, state.plans)),
  );
  // Defense in depth: transport normally guarantees unique provider identities.
  const uniqueActivities = new Map<string, Activity>();
  for (const activity of state.activities) {
    const key = JSON.stringify([
      activity.provider,
      activity.provenance?.sourceAccountId ?? null,
      activity.externalId,
    ]);
    const previous = uniqueActivities.get(key);
    if (
      !previous ||
      activity.revision > previous.revision ||
      (activity.revision === previous.revision && activity.id > previous.id)
    )
      uniqueActivities.set(key, activity);
  }
  const activities = [...uniqueActivities.values()].filter((activity) =>
    inRange(activity.localDate),
  );
  const manual = state.workouts.filter(
    (workout) =>
      !isRest(workout) &&
      workout.completion?.source === 'manual' &&
      workout.completion.status !== 'skipped' &&
      inRange(workout.completion.performedDate),
  );
  const linkedIds = new Set(
    state.workouts.map((workout) => workout.completion?.activityId).filter(Boolean),
  );
  const unmatched = activities.filter((activity) => !linkedIds.has(activity.id));
  const actual = [
    ...activities,
    ...manual.map((workout) => ({
      sport: workout.sport,
      sportSubgroup: workout.sportSubgroup,
      durationSeconds: workout.completion!.durationSeconds,
      distanceMeters: workout.completion!.distanceMeters,
      elevationMeters: null,
    })),
  ];
  const plannedStatus = { completed: 0, partial: 0, skipped: 0, pending: 0 };
  for (const workout of planned) plannedStatus[workout.completion?.status ?? 'pending']++;
  const recordedSessions: RecordedSession[] = [
    ...activities.map((activity) => ({
      kind: 'activity' as const,
      id: activity.id,
      title: activity.title || 'Garmin activity',
      sport: activity.sport,
      sportSubgroup: activity.sportSubgroup,
      localDate: activity.localDate,
      startedAt: activity.startedAt,
      durationSeconds: activity.durationSeconds,
    })),
    ...manual.map((workout) => ({
      kind: 'workout' as const,
      id: workout.id,
      title: workout.title,
      sport: workout.sport,
      sportSubgroup: workout.sportSubgroup,
      localDate: workout.completion!.performedDate,
      startedAt: null,
      durationSeconds: workout.completion!.durationSeconds,
    })),
  ].sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      Number(a.startedAt === null) - Number(b.startedAt === null) ||
      (a.startedAt ?? '').localeCompare(b.startedAt ?? '') ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
  return {
    ...range,
    sportBreakdown: breakdown(planned, actual),
    plannedStatus,
    recordedSessions,
    planned: volume(planned),
    actual: {
      ...volume(actual),
      elevationMeters: {
        cycling: total(
          actual
            .filter((session) => session.sport === 'cycling')
            .map((session) => session.elevationMeters),
        ),
        running: total(
          actual
            .filter((session) => session.sport === 'running')
            .map((session) => session.elevationMeters),
        ),
      },
    },
    possibleDuplicateWorkoutIds: manual
      .filter((workout) =>
        unmatched.some(
          (activity) =>
            activity.localDate === workout.completion!.performedDate &&
            canLinkSport(workout, activity),
        ),
      )
      .map((workout) => workout.id),
  };
}

export function weeklySummary(state: WorkspaceState, weekStart: string): TrainingSummary {
  return summarizeRange(state, { startDate: weekStart, endDate: addDays(weekStart, 6) });
}
