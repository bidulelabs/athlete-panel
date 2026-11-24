import { addDays } from '@athlete-panel/ui';
import type { NutritionProduct, RacePlan, Rehearsal, Workout } from '@athlete-panel/contracts';

type ScheduleEntry = RacePlan['nutrition']['schedule'][number];
export type RehearsalValues = Pick<
  Rehearsal,
  'items' | 'extraFluidMillilitres' | 'stomach' | 'conditions' | 'lesson'
>;
export type PlannedItem = Omit<Rehearsal['items'][number], 'takenServings'>;

export const rehearsalWindowStart = (today: string) => addDays(today, -84);

export const isCompletedOrPartial = (workout: Workout) =>
  workout.completion !== null && workout.completion.status !== 'skipped';

export const plannedServings = (entry: ScheduleEntry, durationSeconds: number | null) =>
  durationSeconds === null
    ? null
    : Math.floor(durationSeconds / 60 / entry.everyMinutes) * entry.servings;

export function plannedItems(
  schedule: readonly ScheduleEntry[],
  products: readonly NutritionProduct[],
  durationSeconds: number | null,
): PlannedItem[] {
  return [...new Set(schedule.map((entry) => entry.productId))].flatMap((productId) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return [];
    const servings = schedule
      .filter((entry) => entry.productId === productId)
      .map((entry) => plannedServings(entry, durationSeconds));
    return [
      {
        productName: product.name,
        carbohydrateGrams: product.carbohydrateGrams,
        fluidMillilitres: product.fluidMillilitres,
        plannedServings: servings.includes(null)
          ? null
          : servings.reduce<number>((total, value) => total + value!, 0),
      },
    ];
  });
}

export function sessionsWithoutRehearsal(
  workouts: readonly Workout[],
  rehearsals: readonly Rehearsal[],
  raceId: string,
  earliestDate: string,
) {
  return workouts
    .filter(
      (workout) =>
        isCompletedOrPartial(workout) &&
        workout.completion!.performedDate >= earliestDate &&
        !rehearsals.some(
          (rehearsal) => rehearsal.eventId === raceId && rehearsal.workoutId === workout.id,
        ),
    )
    .sort((left, right) =>
      right.completion!.performedDate.localeCompare(left.completion!.performedDate),
    );
}

const productOfRow = ({
  productName,
  carbohydrateGrams,
  fluidMillilitres,
  plannedServings,
}: Rehearsal['items'][number]) => [
  productName,
  carbohydrateGrams,
  fluidMillilitres,
  plannedServings,
];

export function changedRehearsalValues(
  opened: RehearsalValues,
  saved: RehearsalValues,
  written: RehearsalValues,
): Partial<RehearsalValues> {
  const { items: writtenItems, ...writtenFields } = written;
  const changedFields = Object.fromEntries(
    Object.entries(writtenFields).filter(
      ([field, value]) =>
        JSON.stringify(value) !== JSON.stringify(opened[field as keyof RehearsalValues]),
    ),
  );
  const rowsEdited = writtenItems.some(
    (item, index) => item.takenServings !== opened.items[index]!.takenServings,
  );
  if (!rowsEdited) return changedFields;
  if (
    JSON.stringify(saved.items.map(productOfRow)) !== JSON.stringify(opened.items.map(productOfRow))
  )
    throw new Error(
      'The products of this rehearsal changed elsewhere. Close and reopen it to edit servings.',
    );
  const savedItemsWithChanges = saved.items.map((savedItem, index) =>
    writtenItems[index]!.takenServings !== opened.items[index]!.takenServings
      ? { ...savedItem, takenServings: writtenItems[index]!.takenServings }
      : savedItem,
  );
  return JSON.stringify(savedItemsWithChanges) === JSON.stringify(saved.items)
    ? changedFields
    : { ...changedFields, items: savedItemsWithChanges };
}

export function rehearsalsOfRace(
  rehearsals: readonly Rehearsal[],
  workouts: readonly Workout[],
  raceId: string,
) {
  return rehearsals
    .filter((rehearsal) => rehearsal.eventId === raceId)
    .map((rehearsal) => ({
      rehearsal,
      workout: workouts.find((workout) => workout.id === rehearsal.workoutId)!,
    }))
    .sort((left, right) =>
      (right.workout.completion?.performedDate ?? '').localeCompare(
        left.workout.completion?.performedDate ?? '',
      ),
    );
}

export function takenTotals(
  items: readonly Rehearsal['items'][number][],
  extraFluidMillilitres: number,
  durationSeconds: number | null,
) {
  const takenItems = items.filter((item) => item.takenServings > 0);
  const knownCarbohydrate = takenItems.filter((item) => item.carbohydrateGrams !== null);
  const carbohydrateGrams =
    takenItems.length > 0 && knownCarbohydrate.length === 0
      ? null
      : knownCarbohydrate.reduce(
          (total, item) => total + item.carbohydrateGrams! * item.takenServings,
          0,
        );
  return {
    carbohydrateGrams,
    carbohydrateGramsPerHour:
      carbohydrateGrams !== null && durationSeconds
        ? (carbohydrateGrams * 3600) / durationSeconds
        : null,
    fluidMillilitres: takenItems.some((item) => item.fluidMillilitres === null)
      ? null
      : takenItems.reduce(
          (total, item) => total + item.fluidMillilitres! * item.takenServings,
          extraFluidMillilitres,
        ),
    productsWithoutCarbohydrate: takenItems
      .filter((item) => item.carbohydrateGrams === null)
      .map((item) => item.productName),
  };
}

export function takenTotalsText(totals: ReturnType<typeof takenTotals>) {
  const carbohydrate =
    totals.carbohydrateGrams === null
      ? 'carbohydrate unknown'
      : totals.carbohydrateGramsPerHour === null
        ? `${Math.round(totals.carbohydrateGrams)} g carbohydrate`
        : `${Math.round(totals.carbohydrateGramsPerHour)} g carbohydrate per hour`;
  const fluid =
    totals.fluidMillilitres === null
      ? 'fluid unknown'
      : `${(totals.fluidMillilitres / 1000).toFixed(1)} L fluid`;
  return `${carbohydrate} · ${fluid}`;
}

export function rehearsalSummaryText(rehearsal: Rehearsal, workout: Workout) {
  const totals = takenTotals(
    rehearsal.items,
    rehearsal.extraFluidMillilitres,
    workout.completion?.durationSeconds ?? null,
  );
  const notCounted = totals.productsWithoutCarbohydrate.length;
  return [
    takenTotalsText(totals),
    totals.carbohydrateGrams !== null &&
      notCounted > 0 &&
      `${notCounted} ${notCounted === 1 ? 'product' : 'products'} not counted`,
    rehearsal.conditions,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function rehearsalEmptyStateHint(
  hasPlannedProducts: boolean,
  sessionCount: number,
  rehearsalCount: number,
) {
  if (!hasPlannedProducts) return 'Add products to During the race first.';
  if (sessionCount === 0)
    return 'Complete a session in the last 12 weeks to log a fueling rehearsal.';
  return rehearsalCount === 0 ? 'No fueling rehearsal logged yet.' : null;
}
