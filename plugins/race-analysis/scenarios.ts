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
    adjustedEstimate(estimate, sections, plan.stations, {
      effortPercent: assumption.effortPercent,
      weatherPercent: assumption.weatherPercent,
      stations,
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
  scenario: RaceScenario,
  units: string,
) {
  const { basedOn } = scenario;
  const basedOnDistanceById = new Map(
    basedOn.stations.map((station) => [station.id, station.distanceMeters]),
  );
  const planStationIds = new Set(plan.stations.map((station) => station.id));
  return [
    ...(basedOn.courseId === courseId ? [] : ['The course changed.']),
    ...basedOn.stations
      .filter((station) => !planStationIds.has(station.id))
      .map((station) => `The station at ${distance(station.distanceMeters, units)} was removed.`),
    ...plan.stations.flatMap((station) => {
      const distanceMeters = basedOnDistanceById.get(station.id);
      if (distanceMeters === undefined) return [`${station.name} was added.`];
      return distanceMeters === station.distanceMeters ? [] : [`${station.name} was moved.`];
    }),
  ];
}
