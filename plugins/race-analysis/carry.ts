import type { NutritionProduct, RacePlan } from '@athlete-panel/contracts';
import { hourlyIntake } from './nutrition';
import type { stationArrivals } from './race-day';

type Station = RacePlan['stations'][number];
type Nutrition = RacePlan['nutrition'];
type TimedLeg = {
  fromMeters: number;
  toMeters: number;
  startMinutes: number;
  endMinutes: number;
  station: Station | undefined;
};

const minuteTolerance = 1e-6;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const roundUpServings = (exact: number) => Math.ceil(exact - minuteTolerance);
const intakesBy = (minutes: number, everyMinutes: number) =>
  Math.floor((minutes + minuteTolerance) / everyMinutes);
const nextRestockIndex = (restocks: readonly boolean[], index: number) => {
  const next = restocks.indexOf(true, index + 1);
  return next === -1 ? restocks.length : next;
};
const bagServings = (station: Station | undefined, productId: string) =>
  sum(
    (station?.dropBag ?? [])
      .filter((item) => item.productId === productId)
      .map((item) => item.servings),
  );

function servingsEatenInLeg(
  schedule: Nutrition['schedule'],
  product: NutritionProduct,
  leg: TimedLeg,
) {
  const intakes = schedule
    .filter((item) => item.productId === product.id)
    .map((item) => ({
      count:
        intakesBy(leg.endMinutes, item.everyMinutes) -
        intakesBy(leg.startMinutes, item.everyMinutes),
      firstMinutes: (intakesBy(leg.startMinutes, item.everyMinutes) + 1) * item.everyMinutes,
      servings: item.servings,
    }))
    .filter((intake) => intake.count > 0);
  const eaten = sum(intakes.map((intake) => intake.count * intake.servings));
  if (product.kind !== 'food' || !leg.station?.food || intakes.length === 0) return eaten;
  const firstIntake = intakes.reduce((first, intake) =>
    intake.firstMinutes < first.firstMinutes ? intake : first,
  );
  return eaten - firstIntake.servings;
}

function productServingsCarried(
  schedule: Nutrition['schedule'],
  product: NutritionProduct,
  legs: TimedLeg[],
) {
  let exactSoFar = 0;
  const servingsPerLeg = legs.map((leg) => {
    const before = roundUpServings(exactSoFar);
    exactSoFar += servingsEatenInLeg(schedule, product, leg);
    return roundUpServings(exactSoFar) - before;
  });
  const restocks = legs.map(
    (leg, index) => index === 0 || bagServings(leg.station, product.id) > 0,
  );
  let inPocket = 0;
  return legs.map((leg, index) => {
    let missingServings = 0;
    if (restocks[index]) {
      const needed = sum(servingsPerLeg.slice(index, nextRestockIndex(restocks, index)));
      const available = inPocket + bagServings(leg.station, product.id);
      missingServings = index === 0 ? 0 : Math.max(0, needed - available);
      inPocket = index === 0 ? Math.max(needed, available) : available;
    }
    const carried = inPocket;
    inPocket = Math.max(0, inPocket - servingsPerLeg[index]!);
    return {
      carried,
      missingServings,
      nextRestockMeters: legs[nextRestockIndex(restocks, index) - 1]!.toMeters,
    };
  });
}

function waterCarried(
  legs: TimedLeg[],
  fluidPerHour: number | null,
  carryCapacityMillilitres: number | null,
) {
  if (fluidPerHour === null) return legs.map(() => null);
  const needs = legs.map((leg) => (fluidPerHour * (leg.endMinutes - leg.startMinutes)) / 60);
  const refills = legs.map((leg, index) => index === 0 || !!leg.station?.water);
  let inBottles = 0;
  return legs.map((_leg, index) => {
    const neededMillilitres = refills[index]
      ? sum(needs.slice(index, nextRestockIndex(refills, index)))
      : null;
    if (neededMillilitres !== null)
      inBottles =
        carryCapacityMillilitres === null
          ? neededMillilitres
          : Math.min(neededMillilitres, carryCapacityMillilitres);
    const carried = inBottles;
    inBottles = Math.max(0, inBottles - needs[index]!);
    return {
      millilitres: carried,
      neededMillilitres,
      nextRefillMeters:
        neededMillilitres === null ? null : legs[nextRestockIndex(refills, index) - 1]!.toMeters,
    };
  });
}

function timedLegs(raceDay: ReturnType<typeof stationArrivals>) {
  const stations = raceDay.stations.filter((row) => !row.beyondCourse).map((row) => row.station);
  let movingMinutes = 0;
  return raceDay.legs.map((leg) => {
    const startMinutes = movingMinutes;
    movingMinutes += leg.movingSeconds! / 60;
    return {
      fromMeters: leg.fromMeters,
      toMeters: leg.toMeters,
      startMinutes,
      endMinutes: movingMinutes,
      station: stations.find((station) => station.distanceMeters === leg.fromMeters),
    };
  });
}

export function carryPlan(
  raceDay: ReturnType<typeof stationArrivals>,
  nutrition: Nutrition,
  products: readonly NutritionProduct[],
  carryCapacityMillilitres: number | null,
) {
  if (raceDay.legs.length === 0 || !raceDay.movingSeconds) return null;
  const legs = timedLegs(raceDay);
  const plannedProducts = products.filter((product) =>
    nutrition.schedule.some((item) => item.productId === product.id),
  );
  const pockets = plannedProducts.map((product) => ({
    product,
    legs: productServingsCarried(nutrition.schedule, product, legs),
  }));
  const fluidPerHour =
    nutrition.targets.fluidMillilitresPerHour ??
    hourlyIntake(nutrition.schedule, products).perHour.fluidMillilitres;
  const water = waterCarried(legs, fluidPerHour, carryCapacityMillilitres);
  return {
    legs: legs.map((leg, index) => {
      const bottles = water[index];
      return {
        fromMeters: leg.fromMeters,
        toMeters: leg.toMeters,
        station: leg.station,
        products: pockets
          .map((pocket) => ({ product: pocket.product, servings: pocket.legs[index]!.carried }))
          .filter((carried) => carried.servings > 0),
        missingProducts: pockets
          .filter((pocket) => pocket.legs[index]!.missingServings > 0)
          .map((pocket) => ({
            product: pocket.product,
            servings: pocket.legs[index]!.missingServings,
            nextRestockMeters: pocket.legs[index]!.nextRestockMeters,
          })),
        waterMillilitres: bottles?.millilitres ?? null,
        waterNeededMillilitres: bottles?.neededMillilitres ?? null,
        waterNextRefillMeters: bottles?.nextRefillMeters ?? null,
        waterOverCapacity:
          carryCapacityMillilitres !== null &&
          !!bottles &&
          bottles.neededMillilitres !== null &&
          bottles.neededMillilitres > carryCapacityMillilitres,
      };
    }),
    fluidPerHour,
    carryCapacityMillilitres,
  };
}
