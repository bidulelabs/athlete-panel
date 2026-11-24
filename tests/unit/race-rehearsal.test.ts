import { describe, expect, it } from 'vitest';
import type { NutritionProduct, Rehearsal, Workout } from '@athlete-panel/contracts';
import {
  plannedItems,
  changedRehearsalValues,
  plannedServings,
  rehearsalEmptyStateHint,
  rehearsalSummaryText,
  rehearsalWindowStart,
  rehearsalsOfRace,
  type RehearsalValues,
  sessionsWithoutRehearsal,
  takenTotals,
} from '../../plugins/race-analysis/rehearsal';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const raceId = id(1);
const otherRaceId = id(2);
const product = (number: number, values: Partial<NutritionProduct> = {}): NutritionProduct => ({
  id: id(100 + number),
  name: `Product ${number}`,
  kind: 'gel',
  carbohydrateGrams: 30,
  fluidMillilitres: null,
  sodiumMilligrams: null,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'comfortable',
  ...values,
});
const workout = (
  number: number,
  status: 'completed' | 'partial' | 'skipped' | null,
  performedDate = '2026-11-01',
): Workout =>
  ({
    id: id(number),
    revision: 1,
    title: `Session ${number}`,
    sport: 'running',
    schedule: { kind: 'independent', date: performedDate },
    order: 1,
    steps: [],
    completion:
      status === null
        ? null
        : {
            status,
            performedDate,
            durationSeconds: null,
            distanceMeters: null,
            rpe: null,
            reason: '',
            source: 'manual',
            activityId: null,
          },
  }) as unknown as Workout;
const item = (values: Partial<Rehearsal['items'][number]> = {}) => ({
  productName: 'Citrus gel',
  carbohydrateGrams: 30,
  fluidMillilitres: null,
  plannedServings: 2,
  takenServings: 3,
  ...values,
});

describe('planned servings', () => {
  it('counts whole intakes over the session, the first one after everyMinutes', () => {
    expect(plannedServings({ productId: id(101), servings: 1, everyMinutes: 30 }, 9600)).toBe(5);
    expect(plannedServings({ productId: id(101), servings: 1, everyMinutes: 60 }, 9600)).toBe(2);
    expect(plannedServings({ productId: id(101), servings: 0.5, everyMinutes: 60 }, 9600)).toBe(1);
    expect(plannedServings({ productId: id(101), servings: 1, everyMinutes: 60 }, 3000)).toBe(0);
  });

  it('is unknown without the session duration', () => {
    expect(plannedServings({ productId: id(101), servings: 1, everyMinutes: 30 }, null)).toBeNull();
  });

  it('gives one row per scheduled product, keeps unknown values and skips removed products', () => {
    const drink = product(2, { kind: 'drink', carbohydrateGrams: null, fluidMillilitres: 250 });
    const schedule = [
      { productId: id(101), servings: 1, everyMinutes: 60 },
      { productId: id(102), servings: 1, everyMinutes: 30 },
      { productId: id(101), servings: 1, everyMinutes: 120 },
      { productId: id(199), servings: 1, everyMinutes: 30 },
    ];
    expect(plannedItems(schedule, [product(1), drink, product(3)], 9600)).toEqual([
      {
        productName: 'Product 1',
        carbohydrateGrams: 30,
        fluidMillilitres: null,
        plannedServings: 3,
      },
      {
        productName: 'Product 2',
        carbohydrateGrams: null,
        fluidMillilitres: 250,
        plannedServings: 5,
      },
    ]);
    expect(plannedItems(schedule, [product(1)], null)).toMatchObject([{ plannedServings: null }]);
  });

  it('lists the products in the order of the plan, not of Settings', () => {
    const schedule = [
      { productId: id(103), servings: 1, everyMinutes: 60 },
      { productId: id(101), servings: 1, everyMinutes: 60 },
    ];
    expect(
      plannedItems(schedule, [product(1), product(3)], 9600).map((item) => item.productName),
    ).toEqual(['Product 3', 'Product 1']);
  });
});

describe('sessions offered for a rehearsal', () => {
  const rehearsed = { eventId: raceId, workoutId: id(4) } as Rehearsal;
  it('offers completed and partial sessions of the last 12 weeks not yet logged for this race, newest first', () => {
    const workouts = [
      workout(1, 'completed', '2026-10-20'),
      workout(2, 'partial', '2026-11-10'),
      workout(3, 'skipped'),
      workout(4, 'completed'),
      workout(5, null),
      workout(6, 'completed', '2026-08-29'),
      workout(7, 'completed', '2026-08-30'),
    ];
    const earliest = rehearsalWindowStart('2026-11-22');
    expect(earliest).toBe('2026-08-30');
    expect(
      sessionsWithoutRehearsal(workouts, [rehearsed], raceId, earliest).map(
        (session) => session.id,
      ),
    ).toEqual([id(2), id(1), id(7)]);
    expect(
      sessionsWithoutRehearsal(workouts, [rehearsed], otherRaceId, earliest).map(
        (session) => session.id,
      ),
    ).toContain(id(4));
  });
});

describe('taken totals', () => {
  it('adds known values and the plain water, per hour with the duration', () => {
    const totals = takenTotals(
      [
        item(),
        item({
          productName: 'Drink',
          carbohydrateGrams: 15,
          fluidMillilitres: 250,
          takenServings: 4,
        }),
      ],
      500,
      9600,
    );
    expect(totals).toEqual({
      carbohydrateGrams: 150,
      carbohydrateGramsPerHour: 56.25,
      fluidMillilitres: null,
      productsWithoutCarbohydrate: [],
    });
    expect(
      takenTotals([item({ fluidMillilitres: 100 }), item({ takenServings: 0 })], 500, null)
        .fluidMillilitres,
    ).toBe(800);
  });

  it('names a taken product without carbohydrate and leaves it out', () => {
    const totals = takenTotals(
      [item(), item({ productName: 'Crackers', carbohydrateGrams: null, takenServings: 1 })],
      0,
      null,
    );
    expect(totals.carbohydrateGrams).toBe(90);
    expect(totals.carbohydrateGramsPerHour).toBeNull();
    expect(totals.productsWithoutCarbohydrate).toEqual(['Crackers']);
  });

  it('keeps carbohydrate unknown when no taken product has a value, and ignores products not taken', () => {
    const totals = takenTotals(
      [
        item({ carbohydrateGrams: null }),
        item({ productName: 'Spare', carbohydrateGrams: null, takenServings: 0 }),
      ],
      0,
      9600,
    );
    expect(totals.carbohydrateGrams).toBeNull();
    expect(totals.carbohydrateGramsPerHour).toBeNull();
    expect(totals.productsWithoutCarbohydrate).toEqual(['Citrus gel']);
  });

  it('counts nothing taken and a known 0 as 0', () => {
    expect(takenTotals([item({ takenServings: 0 })], 0, 9600).carbohydrateGrams).toBe(0);
    expect(takenTotals([item({ carbohydrateGrams: 0 })], 0, 9600).carbohydrateGrams).toBe(0);
  });
});

describe('rehearsal list', () => {
  const rehearsal = (values: Partial<Rehearsal> = {}) =>
    ({
      eventId: raceId,
      workoutId: id(1),
      items: [item({ fluidMillilitres: 0 })],
      extraFluidMillilitres: 500,
      stomach: 'mild',
      conditions: '14 °C, dry',
      lesson: 'Less sweet after 2 hours.',
      ...values,
    }) as Rehearsal;
  const timed = (durationSeconds: number | null) => {
    const session = workout(1, 'completed');
    return { ...session, completion: { ...session.completion!, durationSeconds } } as Workout;
  };

  it('shows carbohydrate per hour with a duration and the total without', () => {
    expect(rehearsalSummaryText(rehearsal(), timed(9600))).toBe(
      '34 g carbohydrate per hour · 0.5 L fluid · 14 °C, dry',
    );
    expect(rehearsalSummaryText(rehearsal({ conditions: '' }), timed(null))).toBe(
      '90 g carbohydrate · 0.5 L fluid',
    );
  });

  it('counts the products left out and says when fluid or carbohydrate is unknown', () => {
    const crackers = item({ productName: 'Crackers', carbohydrateGrams: null, takenServings: 1 });
    expect(
      rehearsalSummaryText(rehearsal({ items: [item(), crackers, crackers] }), timed(9600)),
    ).toBe('34 g carbohydrate per hour · fluid unknown · 2 products not counted · 14 °C, dry');
    expect(
      rehearsalSummaryText(
        rehearsal({ items: [{ ...crackers, fluidMillilitres: 0 }] }),
        timed(9600),
      ),
    ).toBe('carbohydrate unknown · 0.5 L fluid · 14 °C, dry');
  });

  it('lists the rehearsals of the race newest first, those without a date last', () => {
    const workouts = [
      workout(1, 'completed', '2026-10-20'),
      workout(2, null),
      workout(3, 'partial', '2026-11-10'),
    ];
    const rehearsals = [1, 2, 3].map((number) =>
      rehearsal({ id: id(10 + number), workoutId: id(number) }),
    );
    expect(
      rehearsalsOfRace(
        [...rehearsals, rehearsal({ id: id(20), eventId: otherRaceId })],
        workouts,
        raceId,
      ).map(({ rehearsal }) => rehearsal.id),
    ).toEqual([id(13), id(11), id(12)]);
  });
});

describe('rehearsalEmptyStateHint', () => {
  it('asks for planned products before anything else', () => {
    expect(rehearsalEmptyStateHint(false, 0, 0)).toBe('Add products to During the race first.');
  });

  it('asks for a completed session when none is left to log', () => {
    expect(rehearsalEmptyStateHint(true, 0, 2)).toBe(
      'Complete a session in the last 12 weeks to log a fueling rehearsal.',
    );
  });

  it('says no rehearsal is logged when sessions are available', () => {
    expect(rehearsalEmptyStateHint(true, 1, 0)).toBe('No fueling rehearsal logged yet.');
  });

  it('shows no hint once a rehearsal is logged and sessions are available', () => {
    expect(rehearsalEmptyStateHint(true, 1, 1)).toBeNull();
  });
});

describe('changed rehearsal values', () => {
  const gel = item({ productName: 'Citrus gel', takenServings: 3 });
  const drink = item({ productName: 'Drink mix', takenServings: 4 });
  const opened = {
    items: [gel, drink],
    extraFluidMillilitres: 500,
    stomach: 'mild' as const,
    conditions: '14 °C, dry',
    lesson: 'Less sweet after 2 hours.',
  };
  const withTaken = (values: RehearsalValues, gelServings: number, drinkServings: number) => ({
    ...values,
    items: [
      { ...values.items[0]!, takenServings: gelServings },
      { ...values.items[1]!, takenServings: drinkServings },
    ],
  });

  it('keeps only the fields that differ from the values the dialog opened with', () => {
    expect(
      changedRehearsalValues(opened, opened, { ...opened, lesson: 'Same gels next time.' }),
    ).toEqual({ lesson: 'Same gels next time.' });
    expect(changedRehearsalValues(opened, opened, { ...opened, stomach: 'poor' })).toEqual({
      stomach: 'poor',
    });
  });

  it('finds nothing changed in an untouched form', () => {
    expect(changedRehearsalValues(opened, opened, { ...opened, items: [gel, drink] })).toEqual({});
  });

  it('keeps a row saved elsewhere when only another row changed in the dialog', () => {
    const saved = withTaken(opened, 3, 5);
    expect(changedRehearsalValues(opened, saved, withTaken(opened, 4, 4))).toEqual({
      items: [
        { ...gel, takenServings: 4 },
        { ...drink, takenServings: 5 },
      ],
    });
  });

  it('keeps the dialog value of a row changed on both sides', () => {
    const saved = withTaken(opened, 3, 5);
    expect(changedRehearsalValues(opened, saved, withTaken(opened, 3, 6))).toEqual({
      items: [gel, { ...drink, takenServings: 6 }],
    });
  });

  it('matches rows by position when two products share a name', () => {
    const twins = {
      ...opened,
      items: [
        item({ productName: 'Orchard gel', carbohydrateGrams: 25, takenServings: 3 }),
        item({ productName: 'Orchard gel', carbohydrateGrams: 40, takenServings: 7 }),
      ],
    };
    const edited = withTaken(twins, 4, 7);
    expect(changedRehearsalValues(twins, twins, edited)).toEqual({
      items: [{ ...twins.items[0]!, takenServings: 4 }, twins.items[1]],
    });
  });

  it('never sends items when no row was edited, even if the saved list changed', () => {
    expect(
      changedRehearsalValues(
        opened,
        { ...opened, items: [gel] },
        {
          ...opened,
          lesson: 'Same gels next time.',
        },
      ),
    ).toEqual({ lesson: 'Same gels next time.' });
  });

  it('refuses to save an edited row when the saved list changed elsewhere', () => {
    expect(() =>
      changedRehearsalValues(opened, { ...opened, items: [gel] }, withTaken(opened, 4, 4)),
    ).toThrow(
      'The products of this rehearsal changed elsewhere. Close and reopen it to edit servings.',
    );
  });

  it('refuses to save an edited row when the saved rows were reordered elsewhere', () => {
    expect(() =>
      changedRehearsalValues(opened, { ...opened, items: [drink, gel] }, withTaken(opened, 4, 4)),
    ).toThrow(
      'The products of this rehearsal changed elsewhere. Close and reopen it to edit servings.',
    );
  });

  it('refuses to save an edited row when a saved product was replaced elsewhere', () => {
    const otherGel = item({ productName: 'Citrus gel', carbohydrateGrams: 40, takenServings: 3 });
    expect(() =>
      changedRehearsalValues(
        opened,
        { ...opened, items: [otherGel, drink] },
        withTaken(opened, 4, 4),
      ),
    ).toThrow(
      'The products of this rehearsal changed elsewhere. Close and reopen it to edit servings.',
    );
  });

  it('sends no items when the dialog changed no row, whatever was saved elsewhere', () => {
    expect(changedRehearsalValues(opened, withTaken(opened, 3, 5), opened)).toEqual({});
  });
});
