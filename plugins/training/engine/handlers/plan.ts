import { planSchema, type Command, type Workout } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';
import { fail } from '../errors';
import { duplicateChildId } from '../identities';
import { historyInPlan, normalizeOrders, placeWorkout } from '../state';

export function handlePlan(
  context: CommandContext,
  command: Extract<
    Command,
    { action: 'plan.create' | 'plan.update' | 'plan.delete' | 'plan.duplicate' }
  >,
): void {
  const { state, options, createId, get } = context;
  switch (command.action) {
    case 'plan.create': {
      state.plans.push(
        planSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }),
      );
      break;
    }
    case 'plan.update': {
      const plan = get(state.plans, command.id, command.expectedRevision);
      const hasHistory = historyInPlan(state, plan.id);
      if (
        hasHistory &&
        (options.actor === 'agent' ||
          (command.values.startDate !== undefined && command.values.startDate !== plan.startDate))
      ) {
        fail(
          'HISTORY_CONFLICT',
          'This plan contains recorded history. Move pending sessions individually or duplicate the plan.',
        );
      }
      Object.assign(plan, command.values);
      normalizeOrders(state);
      break;
    }
    case 'plan.delete': {
      const plan = get(state.plans, command.id, command.expectedRevision);
      if (historyInPlan(state, plan.id))
        fail(
          'HISTORY_CONFLICT',
          'A plan with recorded history cannot be deleted. Clear or unlink completions first.',
        );
      state.workouts = state.workouts.filter(
        (item) => item.schedule.kind !== 'plan' || item.schedule.planId !== plan.id,
      );
      state.notes = state.notes.filter(
        (item) => item.schedule.kind !== 'plan' || item.schedule.planId !== plan.id,
      );
      state.plans = state.plans.filter((item) => item.id !== plan.id);
      normalizeOrders(state);
      break;
    }
    case 'plan.duplicate': {
      const original = get(state.plans, command.id, command.expectedRevision);
      const id = createId(command.values.id);
      state.plans.push({
        ...original,
        id,
        revision: 1,
        title: command.values.title,
        startDate: command.values.startDate,
      });
      const copies = state.workouts
        .filter((item) => item.schedule.kind === 'plan' && item.schedule.planId === original.id)
        .sort(
          (a, b) =>
            (a.schedule.kind === 'plan' ? a.schedule.day : 0) -
              (b.schedule.kind === 'plan' ? b.schedule.day : 0) ||
            a.order - b.order ||
            a.id.localeCompare(b.id),
        );
      for (const item of copies) {
        const copy: Workout = {
          ...structuredClone(item),
          id: createId(duplicateChildId(id, item.id)),
          revision: 1,
          completion: null,
          schedule: {
            kind: 'plan',
            planId: id,
            day: item.schedule.kind === 'plan' ? item.schedule.day : 1,
          },
        };
        state.workouts.push(copy);
        placeWorkout(state, copy, state.workouts.length);
      }
      for (const note of [...state.notes]) {
        if (note.schedule.kind === 'plan' && note.schedule.planId === original.id)
          state.notes.push({
            ...structuredClone(note),
            id: createId(duplicateChildId(id, note.id)),
            revision: 1,
            schedule: { ...note.schedule, planId: id },
          });
      }
      break;
    }
  }
}
