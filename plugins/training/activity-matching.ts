import {
  canLinkSport,
  isRest,
  type CommandInput,
  type Workout,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { effectiveDate, todayInTimeZone } from './dates';

/** The relevant date is the recorded day once the athlete has logged a workout. */
export function matchingDate(workout: Workout, plans: WorkspaceState['plans']): string | null {
  const scheduled = effectiveDate(workout, plans);
  return scheduled ? (workout.completion?.performedDate ?? scheduled) : null;
}

/** Evaluate the whole bipartite candidate set before taking any links. Order cannot break ties. */
export function automaticActivityMatches(
  state: WorkspaceState,
  eligibleIds: ReadonlySet<string>,
  today = todayInTimeZone(state.profile?.timezone),
): CommandInput[] {
  const linked = new Set(state.workouts.map((workout) => workout.completion?.activityId));
  const activities = state.activities.filter(
    (activity) => !linked.has(activity.id) && activity.localDate <= today,
  );
  const workouts = state.workouts.filter(
    (workout) =>
      !isRest(workout) &&
      workout.completion?.status !== 'skipped' &&
      workout.completion?.source !== 'garmin' &&
      matchingDate(workout, state.plans) !== null,
  );
  const candidates = workouts.map((workout) => ({
    workout,
    activities: activities.filter(
      (activity) =>
        activity.localDate === matchingDate(workout, state.plans) &&
        canLinkSport(workout, activity),
    ),
  }));
  return candidates.flatMap(({ workout, activities: matches }) => {
    const activity = matches[0];
    if (
      matches.length !== 1 ||
      !activity ||
      !eligibleIds.has(activity.id) ||
      candidates.filter((candidate) => candidate.activities.some((item) => item.id === activity.id))
        .length !== 1
    )
      return [];
    return [
      {
        action: 'workout.link' as const,
        id: workout.id,
        expectedRevision: workout.revision,
        activityId: activity.id,
      },
    ];
  });
}
