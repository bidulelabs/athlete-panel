import { createHash, randomUUID } from 'node:crypto';
import {
  commandsSchema, workspaceStateSchema, profileSchema, planSchema, workoutSchema,
  noteSchema, eventSchema, injurySchema,
  type Command, type CommandInput, type Entity, type EntityChange, type EntityKind,
  type MutationResult, type Schedule, type WorkspaceState, type Workout,
} from '@athlete-panel/contracts';
import { effectiveDate } from './dates';

export { effectiveDate } from './dates';

export class DomainError extends Error {
  readonly status: number;
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'STALE_REVISION' || code === 'HISTORY_CONFLICT' || code === 'ALREADY_LINKED' ? 409 : 400;
  }
}

function fail(code: string, message: string, details?: unknown): never { throw new DomainError(code, message, details); }
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function duplicateChildId(parentId: string, sourceId: string): string {
  // Stable child identities keep proposal previews and application consistent.
  const hex = createHash('sha256').update(`athlete-panel:duplicate:${parentId}:${sourceId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const collections = {
  plan: 'plans', workout: 'workouts', note: 'notes', event: 'events', injury: 'injuries', activity: 'activities', health: 'health',
} as const;

function allEntities(state: WorkspaceState): Array<{ entity: EntityKind; value: Entity }> {
  const entries: Array<{ entity: EntityKind; value: Entity }> = state.profile ? [{ entity: 'profile', value: state.profile }] : [];
  for (const [entity, collection] of Object.entries(collections)) {
    for (const value of state[collection as keyof typeof state] as Entity[]) entries.push({ entity: entity as EntityKind, value });
  }
  return entries;
}

function assertReferences(state: WorkspaceState): void {
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
    if (schedule.kind === 'plan' && !state.plans.some((plan) => plan.id === schedule.planId)) fail('NOT_FOUND', 'Scheduled plan does not exist.');
    // Also checks date arithmetic overflow for plan-relative dates.
    effectiveDate(item, state.plans);
  }
  const linkedActivities = new Set<string>();
  for (const workout of state.workouts) {
    if (workout.completion?.source !== 'garmin') continue;
    const activityId = workout.completion.activityId;
    const activity = state.activities.find((candidate) => candidate.id === activityId);
    if (!activity) fail('INVALID_STATE', 'Linked activity does not exist.');
    if (linkedActivities.has(activityId!)) fail('ALREADY_LINKED', 'An activity may be linked to only one workout.');
    if (workout.sport !== activity.sport) fail('INVALID_STATE', 'Linked workout and activity sports differ.');
    linkedActivities.add(activityId!);
  }
}

/** Validate parsed storage/import results before committing them to the shared workspace. */
export function validateWorkspace(state: unknown): WorkspaceState {
  const parsed = workspaceStateSchema.parse(state);
  assertReferences(parsed);
  return parsed;
}

function bucket(workout: Workout, state: WorkspaceState): string {
  const date = effectiveDate(workout, state.plans);
  if (date) return `date:${date}`;
  return workout.schedule.kind === 'plan' ? `plan:${workout.schedule.planId}:${workout.schedule.day}` : `date:${workout.schedule.date}`;
}

function normalizeOrders(state: WorkspaceState): void {
  const buckets = new Map<string, Workout[]>();
  for (const workout of state.workouts) {
    const key = bucket(workout, state);
    const items = buckets.get(key) ?? [];
    items.push(workout);
    buckets.set(key, items);
  }
  for (const items of buckets.values()) {
    items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    items.forEach((item, index) => { item.order = index + 1; });
  }
}

function placeWorkout(state: WorkspaceState, workout: Workout, preferredOrder: number): void {
  const key = bucket(workout, state);
  const siblings = state.workouts.filter((candidate) => candidate.id !== workout.id && bucket(candidate, state) === key)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  siblings.splice(Math.min(Math.max(preferredOrder - 1, 0), siblings.length), 0, workout);
  siblings.forEach((item, index) => { item.order = index + 1; });
  normalizeOrders(state);
}

function historyInPlan(state: WorkspaceState, planId: string): boolean {
  return state.workouts.some((workout) => workout.schedule.kind === 'plan' && workout.schedule.planId === planId && workout.completion !== null);
}

const agentActions = new Set([
  'plan.create', 'plan.update', 'plan.delete', 'plan.duplicate',
  'workout.create', 'workout.update', 'workout.delete', 'workout.duplicate', 'workout.reorder',
  'note.create', 'note.update', 'note.delete',
]);

/**
 * Pure, atomic domain mutation: input is never mutated, and a throw returns no writes.
 * All expectedRevision values refer to the transaction's initial snapshot. Each final
 * changed entity increments once, including ordering side effects, regardless of how
 * many commands touch it. A created entity may be referenced at revision 1 in its batch.
 * Domain services do no I/O; callers own authorization, transaction, audit and idempotency.
 */
export function applyCommands(
  input: WorkspaceState,
  inputs: readonly CommandInput[] | readonly Command[],
  options: { actor: 'owner' | 'agent'; idFactory?: () => string },
): MutationResult {
  const initial = validateWorkspace(input);
  const commands = commandsSchema.parse(inputs);
  const state: WorkspaceState = structuredClone(initial);
  const reserved = new Set(allEntities(initial).map(({ value }) => value.id));

  const createId = (supplied?: string): string => {
    const id = supplied ?? options.idFactory?.() ?? randomUUID();
    if (reserved.has(id)) fail('DUPLICATE_ID', 'An entity with this ID already exists.', { id });
    reserved.add(id);
    return id;
  };
  const get = <T extends { id: string; revision: number }>(items: T[], id: string, expectedRevision: number): T => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return fail('NOT_FOUND', 'The requested item does not exist.', { id });
    if (item.revision !== expectedRevision) fail('STALE_REVISION', 'This item changed. Reload before saving.', { id, expectedRevision, currentRevision: item.revision });
    return item;
  };
  const checkSchedule = (schedule: Schedule): void => {
    if (schedule.kind === 'plan' && !state.plans.some((plan) => plan.id === schedule.planId)) fail('NOT_FOUND', 'The selected plan does not exist.');
  };
  const pendingForAgent = (workout: Workout): void => {
    if (options.actor === 'agent' && workout.completion !== null) fail('FORBIDDEN', 'Agents may edit pending workouts only.');
  };

  for (const command of commands) {
    if (options.actor === 'agent' && !agentActions.has(command.action)) fail('FORBIDDEN', 'This command is not available to the training agent.');
    switch (command.action) {
      case 'profile.set': {
        const currentRevision = state.profile?.revision ?? null;
        if (command.expectedRevision !== currentRevision) fail('STALE_REVISION', 'Profile changed. Reload before saving.');
        state.profile = profileSchema.parse({ ...command.values, id: 'owner', revision: currentRevision ?? 1 });
        break;
      }
      case 'plan.create': {
        state.plans.push(planSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }));
        break;
      }
      case 'plan.update': {
        const plan = get(state.plans, command.id, command.expectedRevision);
        const hasHistory = historyInPlan(state, plan.id);
        if (hasHistory && (options.actor === 'agent' || (command.values.startDate !== undefined && command.values.startDate !== plan.startDate))) {
          fail('HISTORY_CONFLICT', 'This plan contains recorded history. Move pending sessions individually or duplicate the plan.');
        }
        Object.assign(plan, command.values);
        normalizeOrders(state);
        break;
      }
      case 'plan.delete': {
        const plan = get(state.plans, command.id, command.expectedRevision);
        if (historyInPlan(state, plan.id)) fail('HISTORY_CONFLICT', 'A plan with recorded history cannot be deleted. Clear or unlink completions first.');
        state.workouts = state.workouts.filter((item) => item.schedule.kind !== 'plan' || item.schedule.planId !== plan.id);
        state.notes = state.notes.filter((item) => item.schedule.kind !== 'plan' || item.schedule.planId !== plan.id);
        state.plans = state.plans.filter((item) => item.id !== plan.id);
        normalizeOrders(state);
        break;
      }
      case 'plan.duplicate': {
        const original = get(state.plans, command.id, command.expectedRevision);
        const id = createId(command.values.id);
        state.plans.push({ ...original, id, revision: 1, title: command.values.title, startDate: command.values.startDate });
        const copies = state.workouts.filter((item) => item.schedule.kind === 'plan' && item.schedule.planId === original.id)
          .sort((a, b) => (a.schedule.kind === 'plan' ? a.schedule.day : 0) - (b.schedule.kind === 'plan' ? b.schedule.day : 0) || a.order - b.order || a.id.localeCompare(b.id));
        for (const item of copies) {
          const copy: Workout = { ...structuredClone(item), id: createId(duplicateChildId(id, item.id)), revision: 1, completion: null, schedule: { kind: 'plan', planId: id, day: item.schedule.kind === 'plan' ? item.schedule.day : 1 } };
          state.workouts.push(copy);
          placeWorkout(state, copy, state.workouts.length);
        }
        for (const note of [...state.notes]) {
          if (note.schedule.kind === 'plan' && note.schedule.planId === original.id) state.notes.push({ ...structuredClone(note), id: createId(duplicateChildId(id, note.id)), revision: 1, schedule: { ...note.schedule, planId: id } });
        }
        break;
      }
      case 'workout.create': {
        checkSchedule(command.values.schedule);
        const workout = workoutSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1, completion: null });
        state.workouts.push(workout);
        placeWorkout(state, workout, command.values.order);
        break;
      }
      case 'workout.update': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        pendingForAgent(workout);
        if (command.values.schedule) {
          checkSchedule(command.values.schedule);
          if (workout.completion && !equal(workout.schedule, command.values.schedule)) fail('HISTORY_CONFLICT', 'Clear completion or unlink the activity before moving this workout.');
        }
        if (workout.completion && command.values.sport && command.values.sport !== workout.sport) fail('HISTORY_CONFLICT', 'Clear completion or unlink the activity before changing its sport.');
        const oldBucket = bucket(workout, state);
        Object.assign(workout, command.values);
        if (oldBucket !== bucket(workout, state) || command.values.order !== undefined) placeWorkout(state, workout, command.values.order ?? 10000);
        break;
      }
      case 'workout.delete': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        pendingForAgent(workout);
        if (workout.completion) fail('HISTORY_CONFLICT', 'Clear completion or unlink the activity before deleting this workout.');
        state.workouts = state.workouts.filter((item) => item.id !== workout.id);
        normalizeOrders(state);
        break;
      }
      case 'workout.duplicate': {
        const original = get(state.workouts, command.id, command.expectedRevision);
        checkSchedule(command.values.schedule);
        const copy: Workout = { ...structuredClone(original), id: createId(command.values.id), revision: 1, title: command.values.title ?? `${original.title} (copy)`, schedule: command.values.schedule, completion: null };
        state.workouts.push(copy);
        placeWorkout(state, copy, 10000);
        break;
      }
      case 'workout.complete': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        if (workout.completion?.source === 'garmin') {
          const activity = state.activities.find((candidate) => candidate.id === workout.completion?.activityId);
          if (!activity) fail('NOT_FOUND', 'The linked activity does not exist.');
          if (command.values.status === 'skipped') fail('HISTORY_CONFLICT', 'Unlink the actual activity before marking the workout skipped.');
          if (command.values.performedDate !== activity.localDate ||
              (command.values.durationSeconds !== null && command.values.durationSeconds !== activity.durationSeconds) ||
              (command.values.distanceMeters !== null && command.values.distanceMeters !== activity.distanceMeters)) {
            fail('HISTORY_CONFLICT', 'Garmin supplies the actual date, duration and distance. Unlink before entering different manual actuals.');
          }
          workout.completion = {
            ...workout.completion, status: command.values.status, reason: command.values.reason, rpe: command.values.rpe,
            performedDate: activity.localDate, durationSeconds: activity.durationSeconds, distanceMeters: activity.distanceMeters,
          };
          break;
        }
        if (!effectiveDate(workout, state.plans)) fail('INVALID_SCHEDULE', 'Schedule this plan before recording completion.');
        const skipped = command.values.status === 'skipped';
        workout.completion = {
          ...command.values, source: 'manual', activityId: null,
          durationSeconds: skipped ? null : command.values.durationSeconds,
          distanceMeters: skipped ? null : command.values.distanceMeters,
          rpe: skipped ? null : command.values.rpe,
        };
        break;
      }
      case 'workout.clearCompletion': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        if (workout.completion?.source === 'garmin') fail('HISTORY_CONFLICT', 'Use unlink to remove an imported completion.');
        workout.completion = null;
        break;
      }
      case 'workout.link': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        const activity = state.activities.find((candidate) => candidate.id === command.activityId);
        if (!activity) fail('NOT_FOUND', 'Imported activity does not exist.');
        if (!effectiveDate(workout, state.plans)) fail('INVALID_SCHEDULE', 'Schedule this plan before linking an activity.');
        if (workout.sport !== activity.sport) fail('INVALID_LINK', 'Link an activity of the same sport.');
        if (state.workouts.some((candidate) => candidate.id !== workout.id && candidate.completion?.activityId === activity.id)) fail('ALREADY_LINKED', 'This activity is already linked to another workout.');
        if (workout.completion?.source === 'garmin' && workout.completion.activityId !== activity.id) fail('ALREADY_LINKED', 'Unlink the current activity before linking another.');
        if (workout.completion?.status === 'skipped') fail('HISTORY_CONFLICT', 'Clear skipped completion before linking an actual activity.');
        workout.completion = {
          status: 'completed', source: 'garmin', performedDate: activity.localDate,
          durationSeconds: activity.durationSeconds, distanceMeters: activity.distanceMeters,
          activityId: activity.id, rpe: workout.completion?.rpe ?? null, reason: '',
        };
        break;
      }
      case 'workout.unlink': {
        const workout = get(state.workouts, command.id, command.expectedRevision);
        if (workout.completion?.source !== 'garmin') fail('INVALID_LINK', 'This workout has no linked activity.');
        // Old manual actuals are intentionally not an active fallback. Imported
        // activity remains in history and continues to count exactly once.
        workout.completion = null;
        break;
      }
      case 'workout.reorder': {
        const desired = command.workouts.map((entry) => get(state.workouts, entry.id, entry.expectedRevision));
        if (new Set(desired.map((item) => item.id)).size !== desired.length) fail('INVALID_ORDER', 'A reorder cannot contain duplicate workouts.');
        const existing = state.workouts.filter((item) => effectiveDate(item, state.plans) === command.date);
        if (existing.length !== desired.length || desired.some((item) => effectiveDate(item, state.plans) !== command.date)) fail('INVALID_ORDER', 'A reorder must contain every workout on the selected day, exactly once.');
        desired.forEach((item, index) => { pendingForAgent(item); item.order = index + 1; });
        break;
      }
      case 'note.create': {
        checkSchedule(command.values.schedule);
        state.notes.push(noteSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }));
        break;
      }
      case 'note.update': {
        const note = get(state.notes, command.id, command.expectedRevision);
        if (command.values.schedule) checkSchedule(command.values.schedule);
        Object.assign(note, command.values);
        break;
      }
      case 'note.delete': {
        get(state.notes, command.id, command.expectedRevision);
        state.notes = state.notes.filter((item) => item.id !== command.id);
        break;
      }
      case 'event.create': {
        state.events.push(eventSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }));
        break;
      }
      case 'event.update': {
        Object.assign(get(state.events, command.id, command.expectedRevision), command.values);
        break;
      }
      case 'event.delete': {
        get(state.events, command.id, command.expectedRevision);
        state.events = state.events.filter((item) => item.id !== command.id);
        break;
      }
      case 'injury.create': {
        state.injuries.push(injurySchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }));
        break;
      }
      case 'injury.update': {
        Object.assign(get(state.injuries, command.id, command.expectedRevision), command.values);
        break;
      }
      case 'injury.delete': {
        get(state.injuries, command.id, command.expectedRevision);
        state.injuries = state.injuries.filter((item) => item.id !== command.id);
        break;
      }
    }
  }

  normalizeOrders(state);
  const beforeById = new Map(allEntities(initial).map((entry) => [entry.value.id, entry]));
  const afterById = new Map(allEntities(state).map((entry) => [entry.value.id, entry]));
  const affectedPlans = new Set<string>();
  const scheduledEntries = [...initial.workouts, ...initial.notes, ...state.workouts, ...state.notes];
  for (const item of scheduledEntries) {
    const previous = beforeById.get(item.id)?.value as typeof item | undefined;
    const next = afterById.get(item.id)?.value as typeof item | undefined;
    const previousDate = previous ? effectiveDate(previous, initial.plans) : null;
    const nextDate = next ? effectiveDate(next, state.plans) : null;
    if (!equal(previous, next) || previousDate !== nextDate) {
      if (previous?.schedule.kind === 'plan') affectedPlans.add(previous.schedule.planId);
      if (next?.schedule.kind === 'plan') affectedPlans.add(next.schedule.planId);
      if (previous && next && previousDate !== nextDate) next.revision = previous.revision + 1;
    }
  }
  // Plans are aggregate concurrency boundaries for edits/deletes of their children.
  for (const plan of state.plans) {
    const previous = initial.plans.find((candidate) => candidate.id === plan.id);
    if (previous && affectedPlans.has(plan.id)) plan.revision = previous.revision + 1;
  }
  const changes: EntityChange[] = [];
  for (const [id, entry] of beforeById) {
    const updated = afterById.get(id);
    if (!updated) changes.push({ entity: entry.entity, id, before: entry.value, after: null });
    else if (!equal(entry.value, updated.value)) {
      updated.value.revision = entry.value.revision + 1;
      changes.push({ entity: entry.entity, id, before: entry.value, after: updated.value });
    }
  }
  for (const [id, entry] of afterById) {
    if (!beforeById.has(id)) changes.push({ entity: entry.entity, id, before: null, after: entry.value });
  }
  for (const change of changes) {
    if (change.entity === 'workout' || change.entity === 'note') {
      change.beforeEffectiveDate = change.before ? effectiveDate(change.before as Workout, initial.plans) : null;
      change.afterEffectiveDate = change.after ? effectiveDate(change.after as Workout, state.plans) : null;
    }
  }
  const checked = validateWorkspace(state);
  return { state: checked, changes: structuredClone(changes) };
}
