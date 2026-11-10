import { periodSchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';
import { editedWeeksInside } from '../../phase-targets';

export function handlePeriod(
  context: CommandContext,
  command: Extract<Command, { action: 'period.create' | 'period.update' | 'period.delete' }>,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'period.create': {
      state.periods.push(
        periodSchema.parse({ ...command.values, id: createId(command.values.id), revision: 1 }),
      );
      break;
    }
    case 'period.update': {
      const period = get(state.periods, command.id, command.expectedRevision);
      Object.assign(period, command.values);
      if (!command.values.editedWeeks) period.editedWeeks = editedWeeksInside(period);
      break;
    }
    case 'period.delete': {
      get(state.periods, command.id, command.expectedRevision);
      state.periods = state.periods.filter((item) => item.id !== command.id);
      break;
    }
  }
}
