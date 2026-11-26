import type {
  CourseEstimate,
  CourseSection,
  NutritionProduct,
  RacePlan,
  RaceScenario,
} from '@athlete-panel/contracts';
import { distance } from '@athlete-panel/ui';
import { carryPlan } from './carry';
import { adjustedEstimate, stationArrivals } from './race-day';

export function scenarioStations(planStations: RacePlan['stations'], scenario: RaceScenario) {
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
  scenario: RaceScenario | null,
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
      .map(({ station, cutoffMarginSeconds }) => ({ name: station.name, cutoffMarginSeconds })),
    carry: carryPlan(timing, plan.nutrition, products, carryCapacityMillilitres),
  };
}

type CarryInputs = {
  products: readonly NutritionProduct[];
  carryCapacityMillilitres: number | null;
};

export function scenarioOutdatedReasons(
  plan: RacePlan,
  courseId: string | null,
  courseEstimateSeconds: number | null,
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
      : changedFromPlan(basedOn.courseEstimateSeconds, courseEstimateSeconds)
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
