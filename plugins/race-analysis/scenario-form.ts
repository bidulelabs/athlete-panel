import type { CommandInput, RacePlan, RaceScenario } from '@athlete-panel/contracts';
import { planChanges, scenarioStations } from './scenarios';

type ScenarioFields = Pick<
  RaceScenario,
  'name' | 'effortPercent' | 'weatherPercent' | 'weatherNote' | 'stops' | 'basedOn'
>;
type TypedScenario = Omit<ScenarioFields, 'basedOn'>;
type ScenarioInPlan = { scenario: RaceScenario; plan: RacePlan };
export type OpenedScenario = ScenarioInPlan & { outdated: boolean };
export type CurrentScenario = ScenarioInPlan & {
  courseId: string | null;
  courseEstimate: CourseEstimate | null;
};

const COPY_SUFFIX = ' (copy)';
const NAME_MAX_LENGTH = 80;

export const stopMinutesText = (stopSeconds: number) => String(stopSeconds / 60);

export const scenarioBasedOn = (
  plan: RacePlan,
  courseId: string | null,
  courseEstimate: CourseEstimate | null,
) => ({
  courseId,
  stations: plan.stations.map(({ id, distanceMeters, stopSeconds, cutoff }) => ({
    id,
    distanceMeters,
    stopSeconds,
    cutoff,
  })),
  courseEstimate: estimateRange(courseEstimate),
  effortPercent: plan.effortPercent,
  weatherPercent: plan.weatherPercent,
});

function nameCutTo(name: string, maxLength: number) {
  let cut = '';
  for (const { segment } of new Intl.Segmenter().segment(name)) {
    if (cut.length + segment.length > maxLength) break;
    cut += segment;
  }
  return cut;
}

function typedScenario(form: FormData, stations: RacePlan['stations']): TypedScenario {
  const stopMinutes = form.getAll('stopMinutes');
  return {
    name: String(form.get('name')).trim(),
    effortPercent: Number(form.get('effortPercent')),
    weatherPercent: Number(form.get('weatherPercent')),
    weatherNote: String(form.get('weatherNote')).trim(),
    stops: stations.map((station, index) => ({
      stationId: station.id,
      stopSeconds: Math.round(Number(stopMinutes[index]) * 60),
    })),
  };
}

export function createScenarioCommand(
  form: FormData,
  plan: RacePlan,
  courseId: string | null,
  courseEstimate: CourseEstimate | null,
): CommandInput {
  return {
    action: 'raceScenario.create',
    values: {
      id: crypto.randomUUID(),
      eventId: plan.eventId,
      ...typedScenario(form, plan.stations),
      basedOn: scenarioBasedOn(plan, courseId, courseEstimate),
    },
  };
}

export function duplicateScenarioCommand(scenario: RaceScenario): CommandInput {
  const { name, effortPercent, weatherPercent, weatherNote, stops, basedOn } = scenario;
  return {
    action: 'raceScenario.create',
    values: {
      id: crypto.randomUUID(),
      eventId: scenario.eventId,
      name: `${nameCutTo(name, NAME_MAX_LENGTH - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`,
      effortPercent,
      weatherPercent,
      weatherNote,
      stops,
      basedOn,
    },
  };
}

export function applyScenarioCommand(plan: RacePlan, scenario: RaceScenario): CommandInput {
  const changes = planChanges(plan, scenario);
  return {
    action: 'racePlan.update',
    id: plan.id,
    expectedRevision: plan.revision,
    values: {
      ...Object.fromEntries(
        changes.flatMap((change) => (change.field === 'stop' ? [] : [[change.field, change.to]])),
      ),
      ...(changes.some((change) => change.field === 'stop')
        ? { stations: scenarioStations(plan.stations, scenario) }
        : {}),
    },
  };
}

export function changedScenarioValues(
  form: FormData,
  opened: OpenedScenario,
  current: CurrentScenario,
): Partial<ScenarioFields> {
  const openedStations = scenarioStations(opened.plan.stations, opened.scenario);
  const { stops: typedStops, ...typedFields } = typedScenario(form, openedStations);
  const changedFields = Object.fromEntries(
    Object.entries(typedFields).filter(
      ([field, value]) => value !== opened.scenario[field as keyof typeof typedFields],
    ),
  );
  const editedStationIds = new Set(
    typedStops
      .filter((stop, index) => stop.stopSeconds !== openedStations[index]!.stopSeconds)
      .map((stop) => stop.stationId),
  );
  if (editedStationIds.size === 0 && !opened.outdated) return changedFields;
  const typedSecondsByStationId = new Map(
    typedStops.map((stop) => [stop.stationId, stop.stopSeconds]),
  );
  return {
    ...changedFields,
    stops: scenarioStations(current.plan.stations, current.scenario).map((station) => ({
      stationId: station.id,
      stopSeconds: editedStationIds.has(station.id)
        ? typedSecondsByStationId.get(station.id)!
        : station.stopSeconds,
    })),
    basedOn: scenarioBasedOn(current.plan, current.courseId, current.courseEstimate),
  };
}
