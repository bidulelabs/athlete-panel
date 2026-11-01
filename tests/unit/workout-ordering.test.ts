import { it, expect } from 'vitest';
import {
  emptyWorkspace,
  workoutSchema,
  planSchema,
  type Workout,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { createWorkoutOrdering } from '../../plugins/training/engine/ordering';
import { normalizeOrders, bucket } from '../../plugins/training/engine/state';
import { annualId } from '../fixtures/annual-review';

it.each(['create', 'move', 'delete'] as const)(
  'preserves first-use normalization for %s',
  (operation) => {
    const baseline = emptyWorkspace();
    baseline.workouts = Array.from({ length: 9 }, (_, i) =>
      workoutSchema.parse({
        id: annualId(i + 1),
        revision: 1,
        title: 'Synthetic',
        sport: 'running',
        order: 10 - i,
        schedule: { kind: 'independent', date: `2026-11-0${(i % 3) + 1}` },
      }),
    );
    const indexed = structuredClone(baseline),
      ordering = createWorkoutOrdering(indexed);
    if (operation === 'delete') {
      baseline.workouts.shift();
      const removed = indexed.workouts.shift()!;
      normalizeOrders(baseline);
      ordering.remove(removed);
    } else {
      if (operation === 'create') {
        const created = workoutSchema.parse({ ...baseline.workouts[0], id: annualId(99) });
        baseline.workouts.push(created);
        indexed.workouts.push(structuredClone(created));
      }
      const a = baseline.workouts.at(-1)!,
        b = indexed.workouts.at(-1)!;
      a.schedule = { kind: 'independent', date: '2026-11-01' };
      b.schedule = structuredClone(a.schedule);
      placeWorkout(baseline, a, 2);
      ordering.place(b, 2);
    }
    expect(indexed).toEqual(baseline);
  },
);

it('matches legacy ordering through mixed placements, deletions, plan moves and explicit reorders', () => {
  const baseline = emptyWorkspace();
  baseline.plans = [
    planSchema.parse({ id: annualId(1), revision: 1, title: 'Dated', startDate: '2026-11-01' }),
    planSchema.parse({ id: annualId(2), revision: 1, title: 'Unscheduled' }),
  ];
  baseline.workouts = Array.from({ length: 60 }, (_, i) =>
    workoutSchema.parse({
      id: annualId(100 + i),
      revision: 1,
      title: 'Synthetic',
      sport: 'running',
      order: (i % 7) + 1,
      schedule:
        i % 3
          ? { kind: 'plan', planId: annualId((i % 2) + 1), day: (i % 5) + 1 }
          : { kind: 'independent', date: '2026-11-01' },
    }),
  );
  const indexed = structuredClone(baseline),
    ordering = createWorkoutOrdering(indexed);
  for (let step = 0; step < 120; step++) {
    const position = (step * 13) % baseline.workouts.length;
    const a = baseline.workouts[position]!,
      b = indexed.workouts[position]!;
    if (step % 11 === 0) {
      for (const state of [baseline, indexed])
        state.plans[1]!.startDate = step % 22 ? null : '2026-11-03';
      normalizeOrders(baseline);
      ordering.normalize();
    } else if (step % 7 === 0) {
      baseline.workouts = baseline.workouts.filter((w) => w.id !== a.id);
      indexed.workouts = indexed.workouts.filter((w) => w.id !== b.id);
      normalizeOrders(baseline);
      ordering.remove(b);
    } else {
      if (step % 3 === 0) {
        a.order = 27;
        b.order = 27;
      }
      a.schedule = { kind: 'independent', date: step % 2 ? '2026-11-01' : '2026-11-04' };
      b.schedule = structuredClone(a.schedule);
      placeWorkout(baseline, a, (step % 9) + 1);
      ordering.place(b, (step % 9) + 1);
      const fresh = workoutSchema.parse({ ...a, id: annualId(1000 + step), order: 100 });
      baseline.workouts.push(fresh);
      indexed.workouts.push(structuredClone(fresh));
      placeWorkout(baseline, fresh, 10000);
      ordering.place(indexed.workouts.at(-1)!, 10000);
    }
    expect(indexed).toEqual(baseline);
  }
});

// Previous full-scan algorithm is a behavioral oracle for persisted proposal compatibility.
function placeWorkout(state: WorkspaceState, workout: Workout, preferredOrder: number): void {
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
