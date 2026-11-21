import type { NutritionProduct, RacePlan } from '@athlete-panel/contracts';

type Schedule = RacePlan['nutrition']['schedule'];

export const nutrients = [
  {
    amount: 'carbohydrateGrams',
    target: 'carbohydrateGramsPerHour',
    label: 'Carbohydrate',
    name: 'carbohydrate',
    unit: 'g',
  },
  {
    amount: 'fluidMillilitres',
    target: 'fluidMillilitresPerHour',
    label: 'Fluid',
    name: 'fluid',
    unit: 'ml',
  },
  {
    amount: 'sodiumMilligrams',
    target: 'sodiumMilligramsPerHour',
    label: 'Sodium',
    name: 'sodium',
    unit: 'mg',
  },
] as const;

export type Nutrient = (typeof nutrients)[number];

export function hourlyIntake(schedule: Schedule, products: readonly NutritionProduct[]) {
  const scheduled = schedule.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? [{ ...item, product }] : [];
  });
  const perHour = (amount: Nutrient['amount']) => {
    const known = scheduled.filter(({ product }) => product[amount] !== null);
    return known.length
      ? known.reduce(
          (sum, { product, servings, everyMinutes }) =>
            sum + (product[amount]! * servings * 60) / everyMinutes,
          0,
        )
      : null;
  };
  return {
    perHour: {
      carbohydrateGrams: perHour('carbohydrateGrams'),
      fluidMillilitres: perHour('fluidMillilitres'),
      sodiumMilligrams: perHour('sodiumMilligrams'),
    },
    productsMissingNutrients: [...new Set(scheduled.map(({ product }) => product))].flatMap(
      (product) => {
        const missingNutrients = nutrients.filter(({ amount }) => product[amount] === null);
        return missingNutrients.length ? [{ product, missingNutrients }] : [];
      },
    ),
    removedProductIds: [
      ...new Set(
        schedule
          .filter((item) => !products.some((product) => product.id === item.productId))
          .map((item) => item.productId),
      ),
    ],
  };
}
