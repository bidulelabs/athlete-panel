import { eventSchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

export function handleEvent(
  context: CommandContext,
  command: Extract<Command, { action: 'event.create' | 'event.update' | 'event.delete' }>,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'event.create': {
      state.events.push(
        eventSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }),
      );
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
  }
}
