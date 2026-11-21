import { describe, expect, it } from 'vitest';
import {
  commandSchema,
  emptyWorkspace,
  nutritionProfileSchema,
  profileValuesSchema,
  type CommandInput,
  type NutritionProduct,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { canonical } from '../../packages/host/src/crypto';
import { applyCommands } from '../../plugins/training/engine';
import { boundedContext } from '../../plugins/agent-bridge/proposal-validation';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const run = (state: WorkspaceState, commands: CommandInput[]) =>
  applyCommands(state, commands, { actor: 'owner' });
const gel: NutritionProduct = {
  id: id(1),
  name: 'Synthetic citrus gel',
  kind: 'gel',
  carbohydrateGrams: 30,
  fluidMillilitres: null,
  sodiumMilligrams: 50,
  caffeineMilligrams: 0,
  source: 'label',
  tolerance: 'comfortable',
};
const nutrition = {
  products: [gel],
  carryCapacityMillilitres: 1000,
  preferences: 'Vegetarian.',
};
const accepts = (value: unknown) => nutritionProfileSchema.safeParse(value).success;

describe('nutrition profile contract', () => {
  it('accepts products with unknown values and an unknown capacity', () => {
    expect(accepts(nutrition)).toBe(true);
    expect(
      accepts({
        products: [{ ...gel, carbohydrateGrams: null, sodiumMilligrams: null }],
        carryCapacityMillilitres: null,
        preferences: '',
      }),
    ).toBe(true);
  });

  it('keeps a profile saved before nutrition existed valid and without the key', () => {
    const profile = profileValuesSchema.parse({ displayName: 'Synthetic owner' });
    expect(profile).not.toHaveProperty('nutrition');
  });

  it('accepts 50 products and refuses 51', () => {
    const products = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...gel, id: id(index + 1) }));
    expect(accepts({ ...nutrition, products: products(50) })).toBe(true);
    expect(accepts({ ...nutrition, products: products(51) })).toBe(false);
  });

  it('refuses two products with the same id and accepts two different ids', () => {
    expect(accepts({ ...nutrition, products: [gel, { ...gel, id: id(2) }] })).toBe(true);
    expect(accepts({ ...nutrition, products: [gel, { ...gel, name: 'Copy' }] })).toBe(false);
  });

  it('refuses a product name that is blank after trimming', () => {
    expect(accepts({ ...nutrition, products: [{ ...gel, name: '  Gel  ' }] })).toBe(true);
    expect(accepts({ ...nutrition, products: [{ ...gel, name: '   ' }] })).toBe(false);
  });

  it('refuses invalid values', () => {
    expect(accepts({ ...nutrition, products: [null] })).toBe(false);
    expect(accepts({ ...nutrition, products: [{ ...gel, carbohydrateGrams: -1 }] })).toBe(false);
    expect(accepts({ ...nutrition, products: [{ ...gel, source: 'owner' }] })).toBe(false);
    expect(accepts({ ...nutrition, carryCapacityMillilitres: -1 })).toBe(false);
    expect(accepts({ ...nutrition, preferences: 'x'.repeat(2000) })).toBe(true);
    expect(accepts({ ...nutrition, preferences: 'x'.repeat(2001) })).toBe(false);
  });

  it('lets profile.set carry nutrition and nothing unknown', () => {
    const command = (values: unknown) =>
      commandSchema.safeParse({ action: 'profile.set', expectedRevision: null, values }).success;
    expect(command({ nutrition })).toBe(true);
    expect(command({ nutrition: { ...nutrition, unknown: true } })).toBe(false);
  });
});

describe('profile.set with nutrition', () => {
  const withNutrition = () =>
    run(emptyWorkspace(), [
      {
        action: 'profile.set',
        expectedRevision: null,
        values: { displayName: 'Synthetic owner', nutrition },
      },
    ]).state;

  it('saves nutrition and refuses a stale revision', () => {
    const state = withNutrition();
    expect(state.profile?.nutrition).toEqual(nutrition);
    expect(() =>
      run(state, [
        {
          action: 'profile.set',
          expectedRevision: null,
          values: { nutrition: { ...nutrition, products: [] } },
        },
      ]),
    ).toThrow(/changed/);
  });

  it('keeps nutrition when the Profile & zones form saves', () => {
    const state = withNutrition();
    const next = run(state, [
      {
        action: 'profile.set',
        expectedRevision: 1,
        values: {
          displayName: 'Renamed owner',
          timezone: 'Europe/Paris',
          units: 'metric',
          language: 'en',
          weekStartsOnPreference: 'monday',
          goals: '',
          ftpWatts: null,
          restingHeartRateBpm: null,
          maxHeartRateBpm: null,
          heartRateZones: { cycling: [], running: [] },
          weeklyAvailability: {
            monday: 0,
            tuesday: 0,
            wednesday: 0,
            thursday: 0,
            friday: 0,
            saturday: 0,
            sunday: 0,
          },
        },
      },
    ]).state;
    expect(next.profile?.displayName).toBe('Renamed owner');
    expect(next.profile?.nutrition).toEqual(nutrition);
  });
});

describe('planning context and nutrition', () => {
  const scope = { from: '2026-11-01', to: '2027-06-30', includeNotes: false };
  const state = run(emptyWorkspace(), [
    {
      action: 'profile.set',
      expectedRevision: null,
      values: { displayName: 'Synthetic owner', nutrition },
    },
  ]).state;

  it('leaves nutrition out without a race', () => {
    const context = boundedContext(state, scope);
    expect(context.profile).not.toHaveProperty('nutrition');
    expect(context.profile?.displayName).toBe('Synthetic owner');
  });

  it('gives a grant without a race the same context with or without nutrition', () => {
    const { nutrition: _nutrition, ...profile } = state.profile!;
    expect(canonical(boundedContext(state, scope))).toBe(
      canonical(boundedContext({ ...state, profile }, scope)),
    );
    expect(canonical(boundedContext(state, { ...scope, raceId: id(9) }))).not.toBe(
      canonical(boundedContext({ ...state, profile }, { ...scope, raceId: id(9) })),
    );
  });

  it('shares nutrition with a race', () => {
    expect(boundedContext(state, { ...scope, raceId: id(9) }).profile?.nutrition).toEqual(
      nutrition,
    );
  });
});
