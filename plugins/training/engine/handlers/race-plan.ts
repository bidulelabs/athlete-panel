import { racePlanSchema, type Command, type RacePlan } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';

type StationCommand = NonNullable<
  Extract<Command, { action: 'racePlan.create' }>['values']['stations']
>[number];

function stationsWithOwnerFlags(
  stations: StationCommand[],
  savedStations: RacePlan['stations'],
  actor: 'owner' | 'agent',
): RacePlan['stations'] {
  return stations.map((station) => {
    const saved = savedStations.find((candidate) => candidate.id === station.id);
    const movedByAgent =
      actor === 'agent' &&
      saved !== undefined &&
      (saved.distanceMeters !== station.distanceMeters || saved.name !== station.name);
    return {
      ...station,
      source: station.source ?? saved?.source ?? '',
      verified: movedByAgent ? false : (station.verified ?? saved?.verified ?? false),
    };
  });
}

export function handleRacePlan(
  context: CommandContext,
  command: Extract<Command, { action: 'racePlan.create' | 'racePlan.update' }>,
): void {
  const { state, options, createId, get } = context;
  switch (command.action) {
    case 'racePlan.create': {
      const { id, courseId, target = '', stations, ...values } = command.values;
      state.racePlans.push(
        racePlanSchema.parse({
          ...values,
          ...(stations && { stations: stationsWithOwnerFlags(stations, [], options.actor) }),
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
      const { courseId, stations, ...values } = command.values;
      Object.assign(racePlan, values);
      if (stations)
        racePlan.stations = stationsWithOwnerFlags(stations, racePlan.stations, options.actor);
      const agentWroteStrategy = ['briefing', 'pacing', 'assumptions', 'openQuestions'].some(
        (field) => field in values,
      );
      if (courseId !== undefined && (options.actor === 'owner' || agentWroteStrategy))
        racePlan.writtenFor = { courseId, target: racePlan.target };
      break;
    }
  }
}
