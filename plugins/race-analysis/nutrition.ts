import type { NutritionProduct, RacePlan } from '@athlete-panel/contracts';
import { finishTime } from './presentation';

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

export const targetGapPercent = (perHour: number | null, target: number | null) =>
  perHour === null || !target ? null : Math.round(((perHour - target) / target) * 100);

export function plannedText(perHour: number | null, target: number | null, unit: string) {
  if (perHour === null) return 'planned unknown';
  const planned = `planned ${Math.round(perHour)} ${unit}`;
  const gap = targetGapPercent(perHour, target);
  if (gap === null) return planned;
  return gap === 0
    ? `${planned}, on target`
    : `${planned}, ${Math.abs(gap)}% ${gap < 0 ? 'below' : 'above'}`;
}

export const everyMinutesText = (minutes: number) =>
  minutes < 60
    ? `Every ${minutes} min`
    : minutes === 60
      ? 'Every hour'
      : `Every ${finishTime(minutes * 60)}`;

export const carbohydrateOverMovingTimeText = (
  perHour: number | null,
  movingSeconds: number | null,
) =>
  perHour === null || movingSeconds === null
    ? null
    : `About ${Math.round((perHour * movingSeconds) / 3600)} g carbohydrate over ${finishTime(movingSeconds)} moving.`;
