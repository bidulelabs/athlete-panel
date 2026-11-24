import { describe, expect, it } from 'vitest';
import type { NutritionProduct } from '@athlete-panel/contracts';
import {
  carbohydrateOverMovingTimeText,
  everyMinutesText,
  hourlyIntake,
  nutrients,
  plannedText,
  targetGapPercent,
} from '../../plugins/race-analysis/nutrition';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const product = (number: number, values: Partial<NutritionProduct> = {}): NutritionProduct => ({
  id: id(number),
  name: `Synthetic product ${number}`,
  kind: 'gel',
  carbohydrateGrams: 25,
  fluidMillilitres: null,
  sodiumMilligrams: 50,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'comfortable',
  ...values,
});
const gel = product(1);
const drink = product(2, {
  kind: 'drink',
  carbohydrateGrams: 30,
  fluidMillilitres: 500,
  sodiumMilligrams: 400,
});
const crackers = product(3, { kind: 'food', carbohydrateGrams: null, sodiumMilligrams: 300 });
const every = (item: NutritionProduct, servings: number, everyMinutes: number) => ({
  productId: item.id,
  servings,
  everyMinutes,
});

const [carbohydrate, fluid] = nutrients;

describe('hourly intake', () => {
  it('adds each product at its own rhythm, half servings included', () => {
    expect(hourlyIntake([every(gel, 1, 30), every(drink, 0.5, 30)], [gel, drink])).toEqual({
      perHour: { carbohydrateGrams: 80, fluidMillilitres: 500, sodiumMilligrams: 500 },
      productsMissingNutrients: [{ product: gel, missingNutrients: [fluid] }],
      removedProductIds: [],
    });
  });

  it('leaves a product without carbohydrate out of the total and names it once', () => {
    const intake = hourlyIntake(
      [every(gel, 1, 60), every(crackers, 1, 60), every(crackers, 1, 120)],
      [gel, crackers],
    );
    expect(intake.perHour.carbohydrateGrams).toBe(25);
    expect(intake.perHour.sodiumMilligrams).toBe(500);
    expect(intake.productsMissingNutrients).toEqual([
      { product: gel, missingNutrients: [fluid] },
      { product: crackers, missingNutrients: [carbohydrate, fluid] },
    ]);
  });

  it('keeps a total unknown when no scheduled product has the value, and counts a known 0', () => {
    expect(hourlyIntake([every(crackers, 1, 60)], [crackers]).perHour.carbohydrateGrams).toBeNull();
    const water = product(4, { carbohydrateGrams: 0 });
    expect(hourlyIntake([every(water, 1, 60)], [water]).perHour.carbohydrateGrams).toBe(0);
  });

  it('flags a product removed from the profile and leaves it out of every total', () => {
    expect(hourlyIntake([every(gel, 1, 60), every(drink, 1, 60)], [gel])).toEqual({
      perHour: { carbohydrateGrams: 25, fluidMillilitres: null, sodiumMilligrams: 50 },
      productsMissingNutrients: [{ product: gel, missingNutrients: [fluid] }],
      removedProductIds: [drink.id],
    });
  });

  it('gives no total for an empty schedule or a profile without products', () => {
    expect(hourlyIntake([], [gel])).toEqual({
      perHour: { carbohydrateGrams: null, fluidMillilitres: null, sodiumMilligrams: null },
      productsMissingNutrients: [],
      removedProductIds: [],
    });
    expect(hourlyIntake([every(gel, 1, 60)], []).removedProductIds).toEqual([gel.id]);
  });

  it('names no product when every value is known', () => {
    expect(hourlyIntake([every(drink, 1, 60)], [drink]).productsMissingNutrients).toEqual([]);
  });
});

describe('target gap', () => {
  it.each([
    ['below the target', 50, 60, -17],
    ['above the target', 75, 60, 25],
    ['on the target', 60, 60, 0],
    ['an unknown intake', null, 60, null],
    ['no target', 60, null, null],
    ['a target of 0', 60, 0, null],
  ])('gives the percentage for %s', (_label, perHour, target, expected) => {
    expect(targetGapPercent(perHour, target)).toBe(expected);
  });
});

describe('planned text', () => {
  it.each([
    ['below the target', 50, 60, 'planned 50 g, 17% below'],
    ['above the target', 75, 60, 'planned 75 g, 25% above'],
    ['on the target', 60, 60, 'planned 60 g, on target'],
    ['without a target', 50, null, 'planned 50 g'],
    ['an unknown intake', null, 60, 'planned unknown'],
  ])('reads %s', (_label, perHour, target, expected) => {
    expect(plannedText(perHour, target, 'g')).toBe(expected);
  });
});

describe('every minutes text', () => {
  it.each([
    [30, 'Every 30 min'],
    [60, 'Every hour'],
    [90, 'Every 1h 30m'],
  ])('reads %i minutes', (minutes, expected) => {
    expect(everyMinutesText(minutes)).toBe(expected);
  });
});

describe('carbohydrate over the moving time', () => {
  it('gives the total over the moving time', () => {
    expect(carbohydrateOverMovingTimeText(60, 5 * 3600 + 57 * 60)).toBe(
      'About 357 g carbohydrate over 5h 57m moving.',
    );
  });

  it('counts a moving time of 0 instead of treating it as unknown', () => {
    expect(carbohydrateOverMovingTimeText(60, 0)).toBe(
      'About 0 g carbohydrate over 0h 00m moving.',
    );
  });

  it('gives nothing without a course estimate or a known intake', () => {
    expect(carbohydrateOverMovingTimeText(60, null)).toBeNull();
    expect(carbohydrateOverMovingTimeText(null, 3600)).toBeNull();
  });
});
