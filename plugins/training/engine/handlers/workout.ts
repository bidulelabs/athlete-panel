import { workoutSchema, type Command, type Workout } from '@athlete-panel/contracts';
import { effectiveDate } from '../../dates';
import type { CommandContext } from '../context';
import { fail } from '../errors';
import { bucket, equal, normalizeOrders, placeWorkout } from '../state';

export function handleWorkout(
  context: CommandContext,
  command: Extract<
    Command,
    {
      action:
        | 'workout.create'
        | 'workout.update'
        | 'workout.delete'
        | 'workout.duplicate'
        | 'workout.reorder';
    }
  >,
): void {
  const { state, createId, get, checkSchedule, pendingForAgent } = context;
  switch (command.action) {
    case 'workout.create': {
      checkSchedule(command.values.schedule);
      const workout = workoutSchema.parse({
        ...command.values,
        id: createId(command.values.id),
        revision: 1,
        completion: null,
      });
      state.workouts.push(workout);
      placeWorkout(state, workout, command.values.order);
      break;
    }
    case 'workout.update': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      pendingForAgent(workout);
      if (command.values.schedule) {
        checkSchedule(command.values.schedule);
        if (workout.completion && !equal(workout.schedule, command.values.schedule))
          fail(
            'HISTORY_CONFLICT',
            'Clear completion or unlink the activity before moving this workout.',
          );
      }
      if (workout.completion && command.values.sport && command.values.sport !== workout.sport)
        fail(
          'HISTORY_CONFLICT',
          'Clear completion or unlink the activity before changing its sport.',
        );
      const oldBucket = bucket(workout, state);
      Object.assign(workout, command.values);
      if (oldBucket !== bucket(workout, state) || command.values.order !== undefined)
        placeWorkout(state, workout, command.values.order ?? 10000);
      break;
    }
    case 'workout.delete': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      pendingForAgent(workout);
      if (workout.completion)
        fail(
          'HISTORY_CONFLICT',
          'Clear completion or unlink the activity before deleting this workout.',
        );
      state.workouts = state.workouts.filter((item) => item.id !== workout.id);
      normalizeOrders(state);
      break;
    }
    case 'workout.duplicate': {
      const original = get(state.workouts, command.id, command.expectedRevision);
      checkSchedule(command.values.schedule);
      const copy: Workout = {
        ...structuredClone(original),
        id: createId(command.values.id),
        revision: 1,
        title: command.values.title ?? `${original.title} (copy)`,
        schedule: command.values.schedule,
        completion: null,
      };
      state.workouts.push(copy);
      placeWorkout(state, copy, 10000);
      break;
    }
    case 'workout.reorder': {
      const desired = command.workouts.map((entry) =>
        get(state.workouts, entry.id, entry.expectedRevision),
      );
      if (new Set(desired.map((item) => item.id)).size !== desired.length)
        fail('INVALID_ORDER', 'A reorder cannot contain duplicate workouts.');
      const existing = state.workouts.filter(
        (item) => effectiveDate(item, state.plans) === command.date,
      );
      if (
        existing.length !== desired.length ||
        desired.some((item) => effectiveDate(item, state.plans) !== command.date)
      )
        fail(
          'INVALID_ORDER',
          'A reorder must contain every workout on the selected day, exactly once.',
        );
      desired.forEach((item, index) => {
        pendingForAgent(item);
        item.order = index + 1;
      });
      break;
    }
  }
}
