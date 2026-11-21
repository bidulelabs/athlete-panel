import { describe, expect, it } from 'vitest';
import type { NutritionProduct } from '@athlete-panel/contracts';
import { hourlyIntake, nutrients } from '../../plugins/race-analysis/nutrition';

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
