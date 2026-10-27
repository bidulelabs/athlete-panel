import { noteSchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

export function handleNote(
  context: CommandContext,
  command: Extract<Command, { action: 'note.create' | 'note.update' | 'note.delete' }>,
): void {
  const { state, createId, get, checkSchedule } = context;
  switch (command.action) {
    case 'note.create': {
      checkSchedule(command.values.schedule);
      state.notes.push(
        noteSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }),
      );
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
  }
}
