import { describe, expect, it } from 'vitest';
import {
  emptyRaceNutrition,
  type CourseEstimate,
  type CourseSection,
  type NutritionProduct,
  type RacePlan,
} from '@athlete-panel/contracts';
import { carryPlan } from '../../plugins/race-analysis/carry';
import { stationArrivals } from '../../plugins/race-analysis/race-day';

type Station = RacePlan['stations'][number];
type Nutrition = RacePlan['nutrition'];

const sections: CourseSection[] = [0, 1, 2].map((index) => ({
  index,
  fromMeters: index * 10000,
  toMeters: (index + 1) * 10000,
  ascentMeters: 0,
  descentMeters: 0,
}));
const estimate = {
  seconds: 10800,
  lowSeconds: 9000,
  highSeconds: 12600,
  sectionSeconds: [3600, 3600, 3600],
} as CourseEstimate;
const product = (
  number: number,
  kind: NutritionProduct['kind'],
  fluidMillilitres: number | null,
): NutritionProduct => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name: `Synthetic ${kind} ${number}`,
  kind,
  carbohydrateGrams: 25,
  fluidMillilitres,
  sodiumMilligrams: null,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'comfortable',
});
const gel = product(1, 'gel', null);
const drink = product(2, 'drink', 500);
const bar = product(3, 'food', null);
const removedId = '00000000-0000-4000-8000-000000000099';
const station = (
  number: number,
  distanceMeters: number,
  values: Partial<Station> = {},
): Station => ({
  id: `00000000-0000-4000-8000-${String(number + 10).padStart(12, '0')}`,
  name: `Synthetic station ${number}`,
  distanceMeters,
  cutoff: null,
  stopSeconds: 0,
  water: false,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: true,
  ...values,
});
const nutrition = (values: Partial<Nutrition> = {}): Nutrition => ({
  ...emptyRaceNutrition,
  ...values,
});
const plan = (
  stations: Station[],
  values: Partial<Nutrition>,
  capacity: number | null = null,
  courseEstimate: CourseEstimate | null = estimate,
) =>
  carryPlan(
    stationArrivals(courseEstimate, sections, { startTime: null, finishCutoff: null, stations }),
    nutrition(values),
    [gel, drink, bar],
    capacity,
  );
const servingsOf = (carry: ReturnType<typeof plan>, item: NutritionProduct) =>
  carry!.legs.map(
    (leg) => leg.products.find((carried) => carried.product.id === item.id)?.servings ?? 0,
  );
const twoStations = (first: Partial<Station> = {}, second: Partial<Station> = {}) => [
  station(1, 10000, first),
  station(2, 20000, second),
];
const gelsEvery20 = { schedule: [{ productId: gel.id, servings: 1, everyMinutes: 20 }] };

describe('carry plan', () => {
  it('hides carry amounts without leg times', () => {
    expect(plan(twoStations(), gelsEvery20, null, null)).toBeNull();
  });

  it('times the intakes on moving time, so a stop moves none of them', () => {
    expect(servingsOf(plan(twoStations({ stopSeconds: 1800 }), gelsEvery20), gel)).toEqual([
      9, 6, 3,
    ]);
  });

  it('counts an intake that falls on a leg end despite rounding in the leg times', () => {
    const raceDay = stationArrivals(estimate, sections, {
      startTime: null,
      finishCutoff: null,
      stations: twoStations(),
    });
    const legSeconds = [3.8, 3596.2, 3600];
    const carry = carryPlan(
      {
        ...raceDay,
        legs: raceDay.legs.map((leg, index) => ({ ...leg, movingSeconds: legSeconds[index]! })),
      },
      nutrition(gelsEvery20),
      [gel],
      null,
    );
    expect(servingsOf(carry, gel)).toEqual([6, 6, 3]);
  });

  it('carries every product from the start until a drop bag holds it', () => {
    expect(servingsOf(plan(twoStations(), gelsEvery20), gel)).toEqual([9, 6, 3]);
  });

  it('takes the first serving at the interval, adds up half servings and rounds the total up', () => {
    const carry = plan(twoStations(), {
      schedule: [{ productId: gel.id, servings: 0.5, everyMinutes: 40 }],
    });
    expect(servingsOf(carry, gel)).toEqual([2, 1, 0]);
  });

  it('refills from a drop bag and carries the surplus into the next leg', () => {
    const carry = plan(twoStations({ dropBag: [{ productId: gel.id, servings: 8 }] }), gelsEvery20);
    expect(servingsOf(carry, gel)).toEqual([3, 8, 5]);
    expect(carry!.legs.flatMap((leg) => leg.missingProducts)).toEqual([]);
  });

  it('adds the surplus of one drop bag to the next one', () => {
    const carry = plan(
      twoStations(
        { dropBag: [{ productId: gel.id, servings: 8 }] },
        { dropBag: [{ productId: gel.id, servings: 2 }] },
      ),
      gelsEvery20,
    );
    expect(servingsOf(carry, gel)).toEqual([3, 8, 7]);
    expect(carry!.legs.flatMap((leg) => leg.missingProducts)).toEqual([]);
  });

  it('reports a drop bag smaller than the need until the finish', () => {
    const carry = plan(twoStations({ dropBag: [{ productId: gel.id, servings: 4 }] }), gelsEvery20);
    expect(servingsOf(carry, gel)).toEqual([3, 4, 1]);
    expect(carry!.legs[1]!.missingProducts).toEqual([
      { product: gel, servings: 2, nextRestockMeters: 30000 },
    ]);
  });

  it('counts a drop bag at the start line with what you bring', () => {
    const carry = plan(
      [station(0, 0, { dropBag: [{ productId: gel.id, servings: 10 }] }), ...twoStations()],
      gelsEvery20,
    );
    expect(servingsOf(carry, gel)).toEqual([10, 7, 4]);
  });

  it('fills water with the need until the next water point, up to the carry capacity', () => {
    const target = {
      targets: { ...emptyRaceNutrition.targets, fluidMillilitresPerHour: 500 },
    };
    const stations = twoStations({}, { water: true });
    const carry = plan(stations, target, 750);
    expect(carry!.legs.map((leg) => leg.waterMillilitres)).toEqual([750, 250, 500]);
    expect(carry!.legs.map((leg) => leg.waterNeededMillilitres)).toEqual([1000, null, 500]);
    expect(carry!.legs.map((leg) => leg.waterNextRefillMeters)).toEqual([20000, null, 30000]);
    expect(carry!.legs.map((leg) => leg.waterOverCapacity)).toEqual([true, false, false]);
    expect(plan(stations, target, 2000)!.legs.map((leg) => leg.waterMillilitres)).toEqual([
      1000, 500, 500,
    ]);
    expect(plan(stations, target, 1000)!.legs.some((leg) => leg.waterOverCapacity)).toBe(false);
    expect(plan(stations, target, 0)!.legs.map((leg) => leg.waterOverCapacity)).toEqual([
      true,
      false,
      true,
    ]);
    const unknownCapacity = plan(stations, target, null)!;
    expect(unknownCapacity.legs.map((leg) => leg.waterMillilitres)).toEqual([1000, 500, 500]);
    expect(unknownCapacity.legs.some((leg) => leg.waterOverCapacity)).toBe(false);
  });

  it('refills water and collects the drop bag at the same station', () => {
    const carry = plan(
      twoStations({ water: true, dropBag: [{ productId: drink.id, servings: 2 }] }),
      { schedule: [{ productId: drink.id, servings: 1, everyMinutes: 60 }] },
    );
    expect(servingsOf(carry, drink)).toEqual([1, 2, 1]);
    expect(carry!.legs.map((leg) => leg.waterMillilitres)).toEqual([500, 1000, 500]);
  });

  it('lets station food replace the first planned food serving of the next leg, never adding to it', () => {
    const bars = { schedule: [{ productId: bar.id, servings: 1, everyMinutes: 30 }] };
    expect(servingsOf(plan(twoStations({ food: 'bananas' }), bars), bar)).toEqual([5, 3, 2]);
    expect(servingsOf(plan(twoStations(), bars), bar)).toEqual([6, 4, 2]);
    expect(servingsOf(plan(twoStations({ food: 'bananas' }), gelsEvery20), gel)).toEqual([9, 6, 3]);
  });

  it('replaces one food serving per leg when the food plan lists the product twice', () => {
    const bars = {
      schedule: [
        { productId: bar.id, servings: 1, everyMinutes: 30 },
        { productId: bar.id, servings: 1, everyMinutes: 60 },
      ],
    };
    expect(servingsOf(plan(twoStations(), bars), bar)).toEqual([9, 6, 3]);
    expect(servingsOf(plan(twoStations({ food: 'bananas' }), bars), bar)).toEqual([8, 5, 3]);
  });

  it('keeps the water need unknown without a target or a fluid value', () => {
    const carry = plan(twoStations({ water: true }), gelsEvery20, 500);
    expect(carry!.fluidPerHour).toBeNull();
    expect(carry!.legs.map((leg) => leg.waterMillilitres)).toEqual([null, null, null]);
    expect(carry!.legs.some((leg) => leg.waterOverCapacity)).toBe(false);
  });

  it('leaves removed products out, from the food plan and the drop bags', () => {
    const carry = plan(twoStations({ dropBag: [{ productId: removedId, servings: 1 }] }), {
      schedule: [{ productId: removedId, servings: 1, everyMinutes: 20 }],
    });
    expect(carry!.legs.every((leg) => leg.products.length === 0)).toBe(true);
    expect(carry!.legs.flatMap((leg) => leg.missingProducts)).toEqual([]);
  });

  it('ignores a station beyond the course and still counts unconfirmed stations', () => {
    const carry = plan(
      [
        station(1, 10000, { verified: false, water: true }),
        station(2, 20000, { verified: false }),
        station(3, 40000, { verified: false, dropBag: [{ productId: gel.id, servings: 9 }] }),
      ],
      gelsEvery20,
    );
    expect(carry!.legs).toHaveLength(3);
    expect(servingsOf(carry, gel)).toEqual([9, 6, 3]);
    expect(carry!.legs[1]!.station?.name).toBe('Synthetic station 1');
  });
});
