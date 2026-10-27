import { injurySchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

export function handleInjury(
  context: CommandContext,
  command: Extract<Command, { action: 'injury.create' | 'injury.update' | 'injury.delete' }>,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'injury.create': {
      state.injuries.push(
        injurySchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }),
      );
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
