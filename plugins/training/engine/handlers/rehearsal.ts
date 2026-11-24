import { rehearsalSchema, type Command, type WorkspaceState } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';
import { fail } from '../errors';

export function deleteRehearsalsWithoutRaceOrSession(state: WorkspaceState): void {
  state.rehearsals = state.rehearsals.filter(
    (rehearsal) =>
      state.events.some((event) => event.id === rehearsal.eventId) &&
      state.workouts.some((workout) => workout.id === rehearsal.workoutId),
  );
}

export function handleRehearsal(
  context: CommandContext,
  command: Extract<
    Command,
    { action: 'rehearsal.create' | 'rehearsal.update' | 'rehearsal.delete' }
  >,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'rehearsal.create': {
      const workout = state.workouts.find((item) => item.id === command.values.workoutId);
      if (!workout)
        fail('NOT_FOUND', 'The selected session does not exist.', {
          id: command.values.workoutId,
        });
      if (!workout.completion || workout.completion.status === 'skipped')
        fail(
          'WORKOUT_NOT_COMPLETED',
          'Log a fueling rehearsal on a completed or partial session.',
          {
            id: workout.id,
          },
        );
      state.rehearsals.push(
        rehearsalSchema.parse({
          ...command.values,
          id: createId(command.values.id),
          revision: 1,
        }),
      );
      break;
    }
    case 'rehearsal.update': {
      Object.assign(get(state.rehearsals, command.id, command.expectedRevision), command.values);
      break;
    }
    case 'rehearsal.delete': {
      get(state.rehearsals, command.id, command.expectedRevision);
      state.rehearsals = state.rehearsals.filter((item) => item.id !== command.id);
      break;
    }
  }
}
