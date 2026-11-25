import type {
  CourseEstimate,
  CourseSection,
  NutritionProduct,
  RacePlan,
  RaceScenario,
} from '@athlete-panel/contracts';
import { distance } from '@athlete-panel/ui';
import { carryPlan } from './carry';
import { signedPercent } from './presentation';
import { adjustedEstimate, stationArrivals } from './race-day';

export function scenarioStations(
  planStations: RacePlan['stations'],
  scenario: Pick<RaceScenario, 'stops'>,
) {
  const stopSecondsByStationId = new Map(
    scenario.stops.map((stop) => [stop.stationId, stop.stopSeconds]),
  );
  return planStations.map((station) => ({
    ...station,
    stopSeconds: stopSecondsByStationId.get(station.id) ?? station.stopSeconds,
  }));
}

export function scenarioOutcome(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  plan: RacePlan,
  scenario: Pick<RaceScenario, 'effortPercent' | 'weatherPercent' | 'stops'> | null,
  { products, carryCapacityMillilitres }: CarryInputs,
) {
  const assumption = scenario ?? plan;
  const stations = scenario ? scenarioStations(plan.stations, scenario) : plan.stations;
  const timing = stationArrivals(
    adjustedEstimate(estimate, {
      effortPercent: assumption.effortPercent,
      weatherPercent: assumption.weatherPercent,
    }),
    sections,
    { startTime: plan.startTime, finishCutoff: plan.finishCutoff, stations },
  );
  return {
    finish: timing.finish,
    movingSeconds: timing.movingSeconds,
    stopSeconds: timing.plannedStopSeconds,
    cutoffs: timing.stations
      .filter((arrival) => arrival.cutoffSeconds !== null)
      .map(({ station, timeOfDay, cutoffSeconds, cutoffMarginSeconds }) => ({
        stationId: station.id,
        name: station.name,
        timeOfDay,
        cutoffSeconds,
        cutoffMarginSeconds,
      })),
    stops: timing.stations
      .filter((arrival) => !arrival.beyondCourse)
      .map(({ station }) => ({
        stationId: station.id,
        name: station.name,
        stopSeconds: station.stopSeconds,
      })),
    carry: carryPlan(timing, plan.nutrition, products, carryCapacityMillilitres),
  };
}

export type ScenarioOutcome = ReturnType<typeof scenarioOutcome>;

type CarryInputs = {
  products: readonly NutritionProduct[];
  carryCapacityMillilitres: number | null;
};

export const estimateRange = (estimate: CourseEstimate | null) =>
  estimate && {
    seconds: estimate.seconds,
    lowSeconds: estimate.lowSeconds,
    highSeconds: estimate.highSeconds,
  };

export function scenarioOutdatedReasons(
  plan: RacePlan,
  courseId: string | null,
  courseEstimate: CourseEstimate | null,
  scenario: RaceScenario,
  units: string,
) {
  const { basedOn } = scenario;
  const basedOnStationById = new Map(basedOn.stations.map((station) => [station.id, station]));
  const changedFromPlan = <T>(madeFrom: T | undefined, now: T) =>
    madeFrom !== undefined && JSON.stringify(madeFrom) !== JSON.stringify(now);
  const planStationIds = new Set(plan.stations.map((station) => station.id));
  return [
    ...(basedOn.courseId !== courseId
      ? ['The course changed.']
      : changedFromPlan(basedOn.courseEstimate, estimateRange(courseEstimate))
        ? ['The course estimate changed.']
        : []),
    ...basedOn.stations
      .filter((station) => !planStationIds.has(station.id))
      .map((station) => `The station at ${distance(station.distanceMeters, units)} was removed.`),
    ...plan.stations.flatMap((station) => {
      const madeFrom = basedOnStationById.get(station.id);
      if (madeFrom === undefined) return [`${station.name} was added.`];
      if (madeFrom.distanceMeters !== station.distanceMeters) return [`${station.name} was moved.`];
      return [
        ...(changedFromPlan(madeFrom.stopSeconds, station.stopSeconds)
          ? [`The stop at ${station.name} changed.`]
          : []),
        ...(changedFromPlan(madeFrom.cutoff, station.cutoff)
          ? [`The cutoff at ${station.name} changed.`]
          : []),
      ];
    }),
    ...(changedFromPlan(basedOn.effortPercent, plan.effortPercent)
      ? ["The plan's effort changed."]
      : []),
    ...(changedFromPlan(basedOn.weatherPercent, plan.weatherPercent)
      ? ["The plan's weather changed."]
      : []),
  ];
}

const listText = (items: readonly string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const signedMinutes = (seconds: number) =>
  `${seconds >= 0 ? '+' : '-'}${Math.round(Math.abs(seconds) / 60)} min`;

export function scenarioChanges(
  planOutcome: ScenarioOutcome,
  outcome: ScenarioOutcome,
  plan: Pick<RacePlan, 'effortPercent' | 'weatherPercent'>,
  scenario: Pick<RaceScenario, 'effortPercent' | 'weatherPercent'>,
) {
  const finishSeconds = outcome.finish.fromStart?.seconds;
  const planFinishSeconds = planOutcome.finish.fromStart?.seconds;
  const changedAssumptions = [
    ...(scenario.effortPercent === plan.effortPercent
      ? []
      : [`effort ${signedPercent(scenario.effortPercent)}`]),
    ...(scenario.weatherPercent === plan.weatherPercent
      ? []
      : [`weather ${signedPercent(scenario.weatherPercent)}`]),
  ].join(', ');
  const planStopSecondsById = new Map(
    planOutcome.stops.map((stop) => [stop.stationId, stop.stopSeconds]),
  );
  const namesByStopSeconds = new Map<number, string[]>();
  for (const { stationId, name, stopSeconds } of outcome.stops)
    if (stopSeconds !== planStopSecondsById.get(stationId))
      namesByStopSeconds.set(stopSeconds, [...(namesByStopSeconds.get(stopSeconds) ?? []), name]);
  return {
    finishDeltaMinutes:
      finishSeconds === undefined || planFinishSeconds === undefined
        ? null
        : Math.round((finishSeconds - planFinishSeconds) / 60),
    reasons: [
      ...(changedAssumptions === ''
        ? []
        : [
            outcome.movingSeconds === null || planOutcome.movingSeconds === null
              ? `${changedAssumptions.charAt(0).toUpperCase()}${changedAssumptions.slice(1)}: not calculated without a course estimate`
              : `Moving time ${signedMinutes(outcome.movingSeconds - planOutcome.movingSeconds)}: ${changedAssumptions}`,
          ]),
      ...(namesByStopSeconds.size === 0
        ? []
        : [
            `Stops ${signedMinutes(outcome.stopSeconds - planOutcome.stopSeconds)}: ${[
              ...namesByStopSeconds,
            ]
              .map(([seconds, names]) => `${listText(names)} ${Math.round(seconds / 60)} min`)
              .join(', ')}`,
          ]),
    ],
  };
}
