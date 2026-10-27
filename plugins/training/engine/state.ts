import {
  workspaceStateSchema,
  type Entity,
  type EntityKind,
  type Workout,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { effectiveDate } from '../dates';
import { fail } from './errors';
export const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
export const collections = {
  plan: 'plans',
  workout: 'workouts',
  note: 'notes',
  event: 'events',
  injury: 'injuries',
  activity: 'activities',
  health: 'health',
} as const;
export function allEntities(state: WorkspaceState): Array<{ entity: EntityKind; value: Entity }> {
  const entries: Array<{ entity: EntityKind; value: Entity }> = state.profile
    ? [{ entity: 'profile', value: state.profile }]
    : [];
  for (const [entity, collection] of Object.entries(collections)) {
    for (const value of state[collection as keyof typeof state] as Entity[])
      entries.push({ entity: entity as EntityKind, value });
  }
  return entries;
}
export function assertReferences(state: WorkspaceState): void {
  const ids = new Set<string>();
  for (const { value } of allEntities(state)) {
    if (ids.has(value.id)) fail('INVALID_STATE', 'Entity IDs must be unique.', { id: value.id });
    ids.add(value.id);
  }
  const importedKeys = new Set<string>();
  for (const activity of state.activities) {
    const key = `${activity.provider}:${activity.externalId}`;
    if (importedKeys.has(key)) fail('INVALID_STATE', 'Duplicate provider activity identity.');
    importedKeys.add(key);
  }
  for (const item of [...state.workouts, ...state.notes]) {
    const schedule = item.schedule;
    if (schedule.kind === 'plan' && !state.plans.some((plan) => plan.id === schedule.planId))
      fail('NOT_FOUND', 'Scheduled plan does not exist.');
    // Also checks date arithmetic overflow for plan-relative dates.
    effectiveDate(item, state.plans);
  }
  const linkedActivities = new Set<string>();
  for (const workout of state.workouts) {
    if (workout.completion?.source !== 'garmin') continue;
    const activityId = workout.completion.activityId;
    const activity = state.activities.find((candidate) => candidate.id === activityId);
    if (!activity) fail('INVALID_STATE', 'Linked activity does not exist.');
    if (linkedActivities.has(activityId!))
      fail('ALREADY_LINKED', 'An activity may be linked to only one workout.');
    if (workout.sport !== activity.sport)
      fail('INVALID_STATE', 'Linked workout and activity sports differ.');
    linkedActivities.add(activityId!);
  }
}
export function validateWorkspace(state: unknown): WorkspaceState {
  const parsed = workspaceStateSchema.parse(state);
  assertReferences(parsed);
  return parsed;
}
export function bucket(workout: Workout, state: WorkspaceState): string {
  const date = effectiveDate(workout, state.plans);
  if (date) return `date:${date}`;
  return workout.schedule.kind === 'plan'
    ? `plan:${workout.schedule.planId}:${workout.schedule.day}`
    : `date:${workout.schedule.date}`;
}
export function normalizeOrders(state: WorkspaceState): void {
  const buckets = new Map<string, Workout[]>();
  for (const workout of state.workouts) {
    const key = bucket(workout, state);
    const items = buckets.get(key) ?? [];
    items.push(workout);
    buckets.set(key, items);
  }
  for (const items of buckets.values()) {
    items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    items.forEach((item, index) => {
      item.order = index + 1;
    });
  }
}
export function placeWorkout(
  state: WorkspaceState,
  workout: Workout,
  preferredOrder: number,
): void {
  const key = bucket(workout, state);
  const siblings = state.workouts
    .filter((candidate) => candidate.id !== workout.id && bucket(candidate, state) === key)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  siblings.splice(Math.min(Math.max(preferredOrder - 1, 0), siblings.length), 0, workout);
  siblings.forEach((item, index) => {
    item.order = index + 1;
  });
  normalizeOrders(state);
}
export function historyInPlan(state: WorkspaceState, planId: string): boolean {
  return state.workouts.some(
    (workout) =>
      workout.schedule.kind === 'plan' &&
      workout.schedule.planId === planId &&
      workout.completion !== null,
  );
}
