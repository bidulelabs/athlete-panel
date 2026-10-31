import type { Workout, WorkspaceState } from '@athlete-panel/contracts';
import { bucket } from './state';

const compare = (a: Workout, b: Workout) => a.order - b.order || a.id.localeCompare(b.id);
const number = (items: Workout[]) =>
  items.forEach((item, i) => {
    item.order = i + 1;
  });

/** Batch-local bucket index. Plan-wide changes explicitly rebuild it; edits touch only affected days. */
export function createWorkoutOrdering(state: WorkspaceState) {
  let groups: Map<string, Workout[]> | undefined;
  let keys = new Map<string, string>();
  let normalized = false;
  function rebuild() {
    groups = new Map();
    keys = new Map();
    for (const workout of state.workouts) {
      const key = bucket(workout, state);
      const items = groups.get(key) ?? [];
      items.push(workout);
      groups.set(key, items);
      keys.set(workout.id, key);
    }
  }
  function normalize() {
    rebuild();
    for (const items of groups!.values()) number(items.sort(compare));
    normalized = true;
  }
  function place(workout: Workout, preferredOrder: number) {
    if (!groups) rebuild();
    const previous = keys.get(workout.id),
      next = bucket(workout, state);
    if (previous !== undefined) {
      const old = groups!.get(previous)!.filter((item) => item.id !== workout.id);
      groups!.set(previous, old);
      if (previous !== next) number(old.sort(compare));
    }
    const siblings = groups!.get(next) ?? [];
    siblings.sort(compare);
    siblings.splice(Math.min(Math.max(preferredOrder - 1, 0), siblings.length), 0, workout);
    number(siblings);
    groups!.set(next, siblings);
    keys.set(workout.id, next);
    // Preserve legacy normalization of unrelated pre-existing rows on the first placement.
    if (!normalized) {
      for (const items of groups!.values()) number(items.sort(compare));
      normalized = true;
    }
  }
  function remove(workout: Workout) {
    if (!groups || !normalized) {
      normalize();
      return;
    }
    const key = keys.get(workout.id);
    if (key !== undefined) {
      const items = groups.get(key)!.filter((item) => item.id !== workout.id);
      number(items.sort(compare));
      groups.set(key, items);
      keys.delete(workout.id);
    }
  }
  return { place, remove, normalize };
}
