import { distance, duration } from '@athlete-panel/ui';
import type { NutritionProduct, RaceAnalysis, RacePlan } from '@athlete-panel/contracts';
import { carriedText, type carryPlan } from './carry';
import { everyMinutesText, findProduct, nutrients } from './nutrition';
import {
  arrivalRangeLabel,
  clockTime,
  cutoffMarginText,
  elevationLabel,
  finishTime,
} from './presentation';
import { nutritionIsWritten } from './race-plan-form';
import type { RaceDayTiming, StopArrival } from './race-day';

type Carry = ReturnType<typeof carryPlan>;

export type RaceCardStop = {
  marker: string;
  title: string;
  time: string | null;
  action: string;
  leaveWith: string;
  overCapacity: boolean;
  cutoff: string | null;
  cutoffMissed: boolean;
  details: string;
};

const joinNonEmpty = (parts: readonly (string | null | false)[], separator: string) =>
  parts.filter(Boolean).join(separator);

export const raceCardHasContent = (racePlan: RacePlan) =>
  racePlan.stations.length > 0 || nutritionIsWritten(racePlan.nutrition);

function cutoffLine(arrival: StopArrival) {
  if (arrival.cutoffSeconds === null) return null;
  return joinNonEmpty(
    [`Cutoff ${clockTime(arrival.cutoffSeconds)}`, cutoffMarginText(arrival)],
    ' · ',
  );
}

function writtenForText(racePlan: RacePlan, course: RaceAnalysis['course']) {
  const { courseId, target } = racePlan.writtenFor;
  const courseText =
    courseId === null
      ? 'no course'
      : courseId === course?.id
        ? course.filename
        : 'an earlier course';
  return joinNonEmpty([`Written for ${courseText}`, target && `target ${target}`], ' · ');
}

function foodText(nutrition: RacePlan['nutrition'], products: readonly NutritionProduct[]) {
  const targets = nutrients.flatMap(({ target, name, unit }) => {
    const value = nutrition.targets[target];
    return value === null ? [] : [`${value} ${unit} ${name} per hour`];
  });
  const scheduled = nutrition.schedule.map(
    (item) =>
      `${item.servings} × ${findProduct(products, item.productId)?.name ?? 'Removed product'}, ${everyMinutesText(item.everyMinutes).toLowerCase()}`,
  );
  return joinNonEmpty([targets.join(', '), scheduled.join('; ')], ': ');
}

function cardWarning(hasEstimate: boolean, carry: Carry, scheduled: boolean) {
  if (!hasEstimate) return 'No finish estimate yet: arrival times and carry amounts are not shown.';
  if (!carry) return 'Carry amounts are not shown: the planned stops are longer than the estimate.';
  if (carry.fluidPerHour === null)
    return 'Water to carry is unknown: no fluid target and no fluid in the food plan.';
  if (carry.carryCapacityMillilitres === null)
    return 'Carry capacity is unknown: water is not checked against it.';
  if (!scheduled) return 'No food plan yet: products to carry are not shown.';
  return null;
}

export function raceCardContent({
  racePlan,
  course,
  raceDay,
  carry,
  products,
  units,
}: {
  racePlan: RacePlan;
  course: RaceAnalysis['course'];
  raceDay: RaceDayTiming;
  carry: Carry;
  products: readonly NutritionProduct[];
  units: string;
}) {
  const { finish } = raceDay;
  const nextLegText = (meters: number) => {
    const leg = raceDay.legs.find((candidate) => candidate.fromMeters === meters);
    if (!leg) return null;
    const ascent =
      leg.ascentMeters === null ? [] : [`${elevationLabel(leg.ascentMeters, units)} up`];
    const moving =
      leg.movingSeconds === null ? [] : [`about ${duration(leg.movingSeconds)} moving`];
    return `next ${[distance(leg.toMeters - leg.fromMeters, units), ...ascent, ...moving].join(' · ')}`;
  };
  const leaveWith = (meters: number) => {
    const legCarry = carry?.legs.find((candidate) => candidate.fromMeters === meters);
    const carried = legCarry && carriedText(legCarry);
    const overCapacity = !!legCarry?.waterOverCapacity;
    return {
      text: carried ? `Leave with ${carried}${overCapacity ? ', over capacity' : ''}` : '',
      overCapacity: !!carried && overCapacity,
    };
  };
  const cutoffFields = (arrival: StopArrival) => ({
    cutoff: cutoffLine(arrival),
    cutoffMissed: arrival.cutoffMarginSeconds !== null && arrival.cutoffMarginSeconds < 0,
  });
  const atStart = leaveWith(0);
  const startStop: RaceCardStop = {
    marker: 'S',
    title: racePlan.startTime ? `Start · ${racePlan.startTime}` : 'Start',
    time: null,
    action: '',
    leaveWith: atStart.text,
    overCapacity: atStart.overCapacity,
    cutoff: null,
    cutoffMissed: false,
    details: nextLegText(0) ?? '',
  };
  const stationStops = raceDay.stations.map(
    ({ station, beyondCourse, ...arrival }, index): RaceCardStop => {
      const carried = beyondCourse
        ? { text: '', overCapacity: false }
        : leaveWith(station.distanceMeters);
      return {
        marker: String(index + 1),
        title: `${station.name} · ${distance(station.distanceMeters, units)}`,
        time: beyondCourse ? null : (arrivalRangeLabel(arrival)?.range ?? null),
        action: station.action,
        leaveWith: carried.text,
        overCapacity: carried.overCapacity,
        ...cutoffFields(arrival),
        details: joinNonEmpty(
          [
            station.stopSeconds > 0 && `stop ${duration(station.stopSeconds)}`,
            !beyondCourse && nextLegText(station.distanceMeters),
            beyondCourse && 'beyond the course',
            !station.verified && 'not confirmed',
          ],
          ' · ',
        ),
      };
    },
  );
  const finishStop: RaceCardStop = {
    marker: 'F',
    title: `Finish · ${distance(finish.distanceMeters, units)}`,
    time: null,
    action: '',
    leaveWith: '',
    overCapacity: false,
    ...cutoffFields(finish),
    details: '',
  };
  const finishRange = arrivalRangeLabel(finish);
  return {
    revision: racePlan.revision,
    writtenFor: writtenForText(racePlan, course),
    expectedFinish: finish.timeOfDay
      ? clockTime(finish.timeOfDay.seconds)
      : finish.fromStart
        ? finishTime(finish.fromStart.seconds)
        : null,
    finishRange: finishRange?.range ?? null,
    timesFromStart: !!finish.fromStart && !finish.timeOfDay,
    warning: cardWarning(!!finish.fromStart, carry, racePlan.nutrition.schedule.length > 0),
    briefing: racePlan.briefing.trim(),
    breakfast: racePlan.nutrition.breakfast.trim(),
    stops: [startStop, ...stationStops, finishStop],
    cues: racePlan.nutrition.cues,
    food: foodText(racePlan.nutrition, products),
    recovery: racePlan.nutrition.recovery.trim(),
  };
}

export type RaceCardContent = ReturnType<typeof raceCardContent>;
