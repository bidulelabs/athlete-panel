import {
  type Command,
  type EntityChange,
  type WorkspaceState,
  type WorkoutStep,
  agentScopeSchema,
} from '../../packages/contracts/src';
import { z } from 'zod';
import { canonical } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import { effectiveDate } from '../training/public/server';
type Scope = z.infer<typeof agentScopeSchema>;
export const hasExerciseInstructions = (
  exercises: WorkspaceState['workouts'][number]['exercises'],
) => exercises?.some((exercise) => Boolean(exercise.instructions)) ?? false;
export const hasStepNotes = (steps: WorkoutStep[]) =>
  steps.some((step) =>
    step.kind === 'repeat' ? step.steps.some((child) => Boolean(child.notes)) : Boolean(step.notes),
  );
const withoutStepNotes = (steps: WorkoutStep[]): WorkoutStep[] =>
  steps.map((step) =>
    step.kind === 'repeat'
      ? { ...step, steps: step.steps.map((child) => ({ ...child, notes: '' })) }
      : { ...step, notes: '' },
  );
export function boundedContext(state: WorkspaceState, scope: Scope) {
  const within = (date: string | null) => date !== null && date >= scope.from && date <= scope.to;
  const workouts = state.workouts.filter(
    (w) =>
      within(effectiveDate(w, state.plans)) || (w.completion && within(w.completion.performedDate)),
  );
  const planIds = new Set(
    workouts.flatMap((w) => (w.schedule.kind === 'plan' ? [w.schedule.planId] : [])),
  );
  const notes = scope.includeNotes
    ? state.notes.filter((n) => within(effectiveDate(n, state.plans)))
    : [];
  for (const note of notes) if (note.schedule.kind === 'plan') planIds.add(note.schedule.planId);
  return {
    profile: state.profile,
    plans: state.plans
      .filter((p) => planIds.has(p.id) || within(p.startDate))
      .map((p) => (scope.includeNotes ? p : { ...p, description: '' })),
    workouts: workouts.map((w) =>
      scope.includeNotes
        ? w
        : {
            ...w,
            notes: '',
            steps: withoutStepNotes(w.steps),
            ...(w.exercises
              ? {
                  exercises: w.exercises.map((exercise) => ({
                    ...exercise,
                    ...(exercise.instructions !== undefined ? { instructions: '' } : {}),
                  })),
                }
              : {}),
            completion: w.completion
              ? {
                  ...w.completion,
                  reason: '',
                  ...(w.completion.notes !== undefined ? { notes: '' } : {}),
                }
              : null,
          },
    ),
    notes,
    events: state.events
      .filter((e) => within(e.date))
      .map((e) => (scope.includeNotes ? e : { ...e, notes: '' })),
    injuries: state.injuries
      .filter((i) => i.startDate <= scope.to && (i.endDate === null || i.endDate >= scope.from))
      .map((i) => (scope.includeNotes ? i : { ...i, notes: '' })),
    activities: state.activities.filter((a) => within(a.localDate)),
    health: state.health.filter((h) => within(h.localDate)),
  };
}
export function assertReadableSources(commands: Command[], state: WorkspaceState, scope: Scope) {
  const context = boundedContext(state, scope);
  for (const command of commands) {
    if (command.action === 'workout.reorder') {
      assert(
        command.workouts.every((w) => context.workouts.some((c) => c.id === w.id)),
        'out_of_scope',
        'Reordering references a workout outside the grant.',
        403,
      );
      continue;
    }
    if (!('id' in command)) continue;
    const kind = command.action.split('.')[0],
      items =
        kind === 'plan'
          ? context.plans
          : kind === 'workout'
            ? context.workouts
            : kind === 'note'
              ? context.notes
              : [];
    assert(
      items.some((i) => i.id === command.id),
      'out_of_scope',
      'The command references a source outside the granted context.',
      403,
    );
    if (command.action === 'workout.duplicate') {
      const source = state.workouts.find((w) => w.id === command.id)!;
      assert(
        scope.includeNotes ||
          (!source.notes &&
            !hasStepNotes(source.steps) &&
            !hasExerciseInstructions(source.exercises)),
        'forbidden',
        'Duplicating this workout requires access to its notes.',
        403,
      );
    }
    if (command.action === 'plan.duplicate') {
      const workouts = state.workouts.filter(
        (w) => w.schedule.kind === 'plan' && w.schedule.planId === command.id,
      );
      const notes = state.notes.filter(
        (w) => w.schedule.kind === 'plan' && w.schedule.planId === command.id,
      );
      assert(
        workouts.every((w) => context.workouts.some((c) => c.id === w.id)) &&
          notes.every((w) => context.notes.some((c) => c.id === w.id)),
        'out_of_scope',
        'Duplicating this plan requires access to every source record.',
        403,
      );
      assert(
        scope.includeNotes ||
          (!state.plans.find((p) => p.id === command.id)?.description &&
            workouts.every(
              (w) => !w.notes && !hasStepNotes(w.steps) && !hasExerciseInstructions(w.exercises),
            )),
        'forbidden',
        'Duplicating this plan requires access to its notes.',
        403,
      );
    }
  }
}
export function assertBounded(
  changes: EntityChange[],
  before: WorkspaceState,
  after: WorkspaceState,
  scope: Scope,
) {
  for (const change of changes) {
    assert(
      ['plan', 'workout', 'note'].includes(change.entity),
      'forbidden',
      'Agent changes are limited to pending plans, workouts and selected notes.',
      403,
    );
    if (change.entity === 'note')
      assert(scope.includeNotes, 'forbidden', 'This grant does not include notes.', 403);
    for (const [value, state] of [
      [change.before, before],
      [change.after, after],
    ] as const) {
      if (!value) continue;
      if (change.entity === 'plan') {
        if (
          change.before &&
          change.after &&
          canonical({ ...change.before, revision: 0 }) ===
            canonical({ ...change.after, revision: 0 })
        )
          continue;
        const plan = value as WorkspaceState['plans'][number];
        assert(
          plan.startDate !== null && plan.startDate >= scope.from && plan.startDate <= scope.to,
          'out_of_scope',
          'Plan dates must stay within the grant bounds.',
          403,
        );
        // A plan update can affect every child, including records omitted by the context.
        for (const item of [...state.workouts, ...state.notes].filter(
          (w) => w.schedule.kind === 'plan' && w.schedule.planId === value.id,
        )) {
          const date = effectiveDate(item, state.plans);
          assert(
            date && date >= scope.from && date <= scope.to,
            'out_of_scope',
            'This plan includes records outside the grant bounds.',
            403,
          );
        }
      } else {
        const date = effectiveDate(value as WorkspaceState['workouts'][number], state.plans);
        assert(
          date && date >= scope.from && date <= scope.to,
          'out_of_scope',
          'All affected records must remain within the grant dates.',
          403,
        );
      }
    }
  }
}
