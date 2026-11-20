import { racePlanSchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

export function handleRacePlan(
  context: CommandContext,
  command: Extract<Command, { action: 'racePlan.create' | 'racePlan.update' }>,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'racePlan.create': {
      const { id, courseId, target = '', ...values } = command.values;
      state.racePlans.push(
        racePlanSchema.parse({
          ...values,
          target,
          id: createId(id),
          revision: 1,
          writtenFor: { courseId, target },
        }),
      );
      break;
    }
    case 'racePlan.update': {
      const racePlan = get(state.racePlans, command.id, command.expectedRevision);
      const { courseId, ...values } = command.values;
      Object.assign(racePlan, values);
      if (courseId !== undefined) racePlan.writtenFor = { courseId, target: racePlan.target };
      break;
    }
  }
}
