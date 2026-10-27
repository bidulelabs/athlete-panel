import {
  type EntityChange,
  type MutationResult,
  type Workout,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { effectiveDate } from '../dates';
import { allEntities, equal, normalizeOrders, validateWorkspace } from './state';
export function finalize(initial: WorkspaceState, state: WorkspaceState): MutationResult {
  normalizeOrders(state);
  const beforeById = new Map(allEntities(initial).map((entry) => [entry.value.id, entry]));
  const afterById = new Map(allEntities(state).map((entry) => [entry.value.id, entry]));
  const affectedPlans = new Set<string>();
  const scheduledEntries = [
    ...initial.workouts,
    ...initial.notes,
    ...state.workouts,
    ...state.notes,
  ];
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
    if (!beforeById.has(id))
      changes.push({ entity: entry.entity, id, before: null, after: entry.value });
  }
  for (const change of changes) {
    if (change.entity === 'workout' || change.entity === 'note') {
      change.beforeEffectiveDate = change.before
        ? effectiveDate(change.before as Workout, initial.plans)
        : null;
      change.afterEffectiveDate = change.after
        ? effectiveDate(change.after as Workout, state.plans)
        : null;
    }
  }
  const checked = validateWorkspace(state);
  return { state: checked, changes: structuredClone(changes) };
}
