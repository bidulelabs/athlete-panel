import { describe, expect, it } from 'vitest';
import { emptyRaceNutrition, emptyWorkspace, type CommandInput } from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { namesById } from '../../plugins/agent-bridge/proposal-weeks';
import { proposalRows } from '../../plugins/agent-bridge/proposal-diff';
import { changeTitle, typeLabels } from '../../plugins/agent-bridge/proposal-presentation';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const raceId = id(1);
const productId = id(40);
const withRace = applyCommands(
  emptyWorkspace(),
  [
    {
      action: 'event.create',
      values: { id: raceId, title: 'Synthetic race', kind: 'race', date: '2027-06-20' },
    },
  ],
  { actor: 'owner' },
).state;
const proposeRacePlan = (values: Record<string, unknown>) =>
  applyCommands(
    withRace,
    [
      {
        action: 'racePlan.create',
        values: {
          id: id(10),
          eventId: raceId,
          courseId: null,
          briefing: '',
          pacing: [],
          assumptions: [],
          openQuestions: [],
          ...values,
        },
      },
    ] as CommandInput[],
    { actor: 'agent' },
  ).changes[0]!;
const rowsOf = (values: Record<string, unknown>, names: Record<string, string> = {}) =>
  proposalRows(proposeRacePlan(values), 'metric', names);

describe('review rows of a new race plan', () => {
  it('shows no row for a field the plan leaves empty', () => {
    const fields = rowsOf({ briefing: 'Start easy.' }).map((row) => row.field);
    expect(fields).toContain('Briefing');
    expect(fields).not.toContain('Start time');
    expect(fields).not.toContain('Aid stations');
    expect(fields).not.toContain('Nutrition · Breakfast');
    expect(fields.filter((field) => field.startsWith('Nutrition · Targets'))).toEqual([]);
  });

  it('shows the products by name and the targets with their unit', () => {
    const rows = rowsOf(
      {
        stations: [
          {
            name: 'Synthetic station',
            distanceMeters: 9000,
            cutoff: null,
            stopSeconds: 300,
            water: true,
            food: '',
            dropBag: [{ productId, servings: 2 }],
            action: '',
          },
        ].map((station) => ({ ...station, id: id(30) })),
        nutrition: {
          ...emptyRaceNutrition,
          targets: { ...emptyRaceNutrition.targets, carbohydrateGramsPerHour: 60 },
          schedule: [{ productId, servings: 1, everyMinutes: 30 }],
        },
      },
      { [productId]: 'Synthetic gel' },
    );
    const text = rows.map((row) => `${row.field}: ${row.after}`);
    expect(text).toContain('Nutrition · Targets · Carbohydrate: 60 g per hour');
    expect(text).toContain('Nutrition · Food schedule · Row 1 · Product: Synthetic gel');
    expect(text).toContain('Nutrition · Food schedule · Row 1 · Every: 30 min');
    expect(text).toContain(
      'Aid stations · Aid station 1 · Drop bag · Item 1 · Product: Synthetic gel',
    );
    expect(JSON.stringify(rows)).not.toContain(productId);
    expect(JSON.stringify(rows)).not.toContain(id(30));
  });

  it('names a product that is no longer in the profile', () => {
    const rows = rowsOf({
      nutrition: {
        ...emptyRaceNutrition,
        schedule: [{ productId, servings: 1, everyMinutes: 30 }],
      },
    });
    expect(rows.map((row) => row.after)).toContain('Product no longer in your profile');
  });

  it('shows the race and session titles instead of their ids', () => {
    const racePlanRows = rowsOf({}, { [raceId]: 'Synthetic race' });
    expect(racePlanRows).toContainEqual(
      expect.objectContaining({ field: 'Race', after: 'Synthetic race' }),
    );
    const rehearsalRows = proposalRows(
      {
        entity: 'rehearsal',
        id: id(60),
        before: { id: id(60), eventId: raceId, workoutId: id(61) },
        after: { id: id(60), eventId: raceId, workoutId: id(61) },
      } as never,
      'metric',
      { [raceId]: 'Synthetic race', [id(61)]: 'Long trail' },
    );
    expect(rehearsalRows).toEqual([]);
    const changedSession = proposalRows(
      {
        entity: 'rehearsal',
        id: id(60),
        before: { id: id(60), eventId: raceId, workoutId: id(61) },
        after: { id: id(60), eventId: raceId, workoutId: id(62) },
      } as never,
      'metric',
      { [id(61)]: 'Long trail', [id(62)]: 'Short trail' },
    );
    expect(changedSession).toEqual([
      { field: 'Session', before: 'Long trail', after: 'Short trail' },
    ]);
  });

  it('keeps visible an update that clears a text and a list', () => {
    const rows = proposalRows(
      {
        entity: 'racePlan',
        id: id(10),
        before: { id: id(10), briefing: 'Start easy.', openQuestions: ['Weather?'] },
        after: { id: id(10), briefing: '', openQuestions: [] },
      } as never,
      'metric',
    );
    expect(rows).toEqual([
      { field: 'Briefing', before: 'Start easy.', after: 'Empty' },
      { field: 'Open questions · Open question 1', before: 'Weather?', after: 'Not present' },
    ]);
  });
});

describe('review of a fueling rehearsal in the context changes', () => {
  it('has a label and a title', () => {
    expect(typeLabels.rehearsal).toBe('Fueling rehearsal');
    expect(
      changeTitle({ entity: 'rehearsal', id: id(50), before: null, after: null } as never),
    ).toBe('Fueling rehearsal');
  });
});

describe('review of a product when the profile was not shared', () => {
  it('shows the fallback name given by the caller', () => {
    const change = proposeRacePlan({
      nutrition: {
        ...emptyRaceNutrition,
        schedule: [{ productId, servings: 1, everyMinutes: 30 }],
      },
    });
    const rows = proposalRows(change, 'metric', {}, 'Unknown product');
    expect(rows.map((row) => row.after)).toContain('Unknown product');
    expect(rows.map((row) => row.after)).not.toContain('Product no longer in your profile');
  });
});

describe('review of a schedule swapping two products with the same name', () => {
  it('shows a different product before and after', () => {
    const small = id(41);
    const large = id(42);
    const names = namesById(
      {
        plans: [],
        events: [],
        workouts: [],
        profile: {
          nutrition: {
            products: [
              { id: small, name: 'Orchard gel', kind: 'gel', carbohydrateGrams: 30 },
              { id: large, name: 'Orchard gel', kind: 'gel', carbohydrateGrams: 45 },
            ],
          },
        },
      },
      [],
    );
    const row = (productId: string) => ({ productId, servings: 1, everyMinutes: 30 });
    const rows = proposalRows(
      {
        entity: 'racePlan',
        id: id(10),
        before: { id: id(10), nutrition: { schedule: [row(small)] } },
        after: { id: id(10), nutrition: { schedule: [row(large)] } },
      } as never,
      'metric',
      names,
    );
    expect(rows).toEqual([
      {
        field: 'Nutrition · Food schedule · Row 1 · Product',
        before: 'Orchard gel (30 g carbs)',
        after: 'Orchard gel (45 g carbs)',
      },
    ]);
  });
});
