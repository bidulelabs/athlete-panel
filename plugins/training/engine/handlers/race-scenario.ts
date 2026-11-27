import { raceScenarioSchema, type Command, type WorkspaceState } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

export function deleteScenariosWithoutRace(state: WorkspaceState): void {
  state.raceScenarios = state.raceScenarios.filter((scenario) =>
    state.events.some((event) => event.id === scenario.eventId),
  );
}

export function handleRaceScenario(
  context: CommandContext,
  command: Extract<
    Command,
    { action: 'raceScenario.create' | 'raceScenario.update' | 'raceScenario.delete' }
  >,
): void {
  const { state, createId, get } = context;
  switch (command.action) {
    case 'raceScenario.create': {
      state.raceScenarios.push(
        raceScenarioSchema.parse({
          ...command.values,
          id: createId(command.values.id),
          revision: 1,
        }),
      );
      break;
    }
    case 'raceScenario.update': {
      Object.assign(get(state.raceScenarios, command.id, command.expectedRevision), command.values);
      break;
    }
    case 'raceScenario.delete': {
      get(state.raceScenarios, command.id, command.expectedRevision);
      state.raceScenarios = state.raceScenarios.filter((item) => item.id !== command.id);
      break;
    }
  }
}
