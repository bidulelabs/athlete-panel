import { describe, expect, it } from 'vitest';
import type { WeeklyTarget } from '@athlete-panel/contracts';
import { readTargetFromForm, targetFields } from '../../plugins/training/phases';
import { unitFieldText } from '../../plugins/training/unit-field';
import { readEditedWeek } from '../../plugins/training/phase-weeks';

const target = (first: number, last: number): WeeklyTarget => ({
  firstWeek: { min: first, max: first },
  lastWeek: { min: last, max: last },
});
const periodWith = (stored: WeeklyTarget) => ({
  weeklyDurationSeconds: stored,
  weeklyDistanceMeters: stored,
  weeklyElevationGainMeters: stored,
});
const formShowing = (name: string, shown: WeeklyTarget, factor: number) => {
  const form = new FormData();
  for (const week of ['firstWeek', 'lastWeek'] as const)
    for (const bound of ['min', 'max'] as const)
      form.set(`${name}.${week}.${bound}`, unitFieldText(shown[week][bound], factor));
  return form;
};

describe('phase editor', () => {
  it.each([
    ['metric', 0, target(4000, 5000)],
    ['metric', 1, target(12345.6, 23456.7)],
    ['imperial', 1, target(10000, 20000)],
    ['imperial', 2, target(1000, 1234)],
  ])('keeps an untouched target in %s units (field %i)', (units, index, stored) => {
    const field = targetFields(units)[index]!;
    expect(
      readTargetFromForm(formShowing(field.name, stored, field.factor), field, periodWith(stored)),
    ).toEqual(stored);
  });

  it('reads an edited bound in profile units and keeps the untouched ones', () => {
    const field = targetFields('metric')[0]!;
    const stored = target(4500, 5400);
    const form = formShowing(field.name, stored, field.factor);
    form.set(`${field.name}.lastWeek.max`, '2');
    expect(readTargetFromForm(form, field, periodWith(stored))).toEqual({
      firstWeek: { min: 4500, max: 4500 },
      lastWeek: { min: 5400, max: 7200 },
    });
  });

  it('reads a new target in profile units and none when the target is off', () => {
    const field = targetFields('imperial')[2]!;
    const form = new FormData();
    for (const key of ['firstWeek.min', 'firstWeek.max', 'lastWeek.min', 'lastWeek.max'])
      form.set(`${field.name}.${key}`, '1000');
    expect(readTargetFromForm(form, field, undefined)!.firstWeek.min).toBeCloseTo(304.8);
    expect(readTargetFromForm(new FormData(), field, undefined)).toBeNull();
  });
});

describe('week target editor', () => {
  const fields = targetFields('metric');
  const calculated = {
    weeklyDurationSeconds: { min: 33600, max: 40800 },
    weeklyDistanceMeters: null,
    weeklyElevationGainMeters: { min: 1400, max: 1600 },
  };

  it('stores only the ticked targets and keeps an untouched calculated value exact', () => {
    const form = new FormData();
    form.set('weeklyDurationSeconds.min', unitFieldText(33600, 3600));
    form.set('weeklyDurationSeconds.max', '8');
    expect(readEditedWeek(form, fields, calculated)).toEqual({
      weeklyDurationSeconds: { min: 33600, max: 28800 },
    });
  });

  it('reads no edited week when no target is ticked', () => {
    expect(readEditedWeek(new FormData(), fields, calculated)).toBeNull();
  });
});
