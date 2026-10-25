import { describe, expect, it } from 'vitest';
import { commandSchema, completionSchema, dateSchema, profileValuesSchema, workoutStepSchema } from '@athlete-panel/contracts';

const id = '00000000-0000-4000-8000-000000000001';
const create = (durationSeconds: unknown) => ({ action: 'workout.create', values: { title: 'Ride', sport: 'cycling', schedule: { kind: 'independent', date: '2026-10-24' }, durationSeconds } });

describe('versioned domain contracts', () => {
  it('requires real floating dates, including valid leap days', () => {
    expect(dateSchema.parse('2028-02-29')).toBe('2028-02-29');
    for (const date of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-10-24T00:00:00Z', 'not a date']) expect(dateSchema.safeParse(date).success).toBe(false);
  });
  it('accepts known zero and unknown null but rejects coercion/nonfinite/negative units', () => {
    for (const value of [0, null, 3600, 12.5]) expect(commandSchema.safeParse(create(value)).success).toBe(true);
    for (const value of [-1, NaN, Infinity, '3600', '']) expect(commandSchema.safeParse(create(value)).success).toBe(false);
  });
  it('prohibits conflicting scheduling representations', () => {
    expect(commandSchema.safeParse({ action: 'workout.create', values: { title: 'Ride', sport: 'cycling', schedule: { kind: 'plan', planId: id, day: 0 } } }).success).toBe(false);
    expect(commandSchema.safeParse({ action: 'workout.create', values: { title: 'Ride', sport: 'cycling', schedule: { kind: 'plan', planId: id, day: 1, date: '2026-10-24' } } }).success).toBe(false);
  });
  it('does not inject create defaults into a patch', () => {
    expect(commandSchema.parse({ action: 'workout.update', id, expectedRevision: 1, values: { title: 'Changed' } })).toEqual({ action: 'workout.update', id, expectedRevision: 1, values: { title: 'Changed' } });
    expect(commandSchema.safeParse({ action: 'workout.update', id, expectedRevision: 1, values: {} }).success).toBe(false);
    expect(commandSchema.safeParse({ action: 'workout.update', id, expectedRevision: 1, values: { completion: null } }).success).toBe(false);
  });
  it('validates bounded repeat structures without nested repeats', () => {
    const step = { kind: 'work', durationSeconds: 120, target: { kind: 'powerWatts', min: 200, max: 250 } };
    expect(workoutStepSchema.safeParse({ kind: 'repeat', times: 5, steps: [step, { kind: 'recovery', durationSeconds: 60 }] }).success).toBe(true);
    for (const invalid of [
      { kind: 'work', durationSeconds: 0 },
      { kind: 'work', durationSeconds: 30, distanceMeters: 100 },
      { kind: 'work', durationSeconds: 30, target: { kind: 'rpe', min: 8, max: 11 } },
      { kind: 'work', durationSeconds: 30, target: { kind: 'powerWatts', min: 250, max: 200 } },
      { kind: 'repeat', times: 2, steps: [{ kind: 'repeat', times: 2, steps: [step] }] },
    ]) expect(workoutStepSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires provenance-consistent completion and a partial reason', () => {
    const values = { status: 'completed', performedDate: '2026-10-24', source: 'manual', activityId: null };
    expect(completionSchema.safeParse(values).success).toBe(true);
    expect(completionSchema.safeParse({ ...values, source: 'garmin' }).success).toBe(false);
    expect(completionSchema.safeParse({ ...values, activityId: id }).success).toBe(false);
    expect(completionSchema.safeParse({ ...values, status: 'partial' }).success).toBe(false);
    expect(completionSchema.safeParse({ ...values, status: 'skipped', durationSeconds: 60 }).success).toBe(false);
  });
  it('validates timezone and ascending sport zone upper bounds', () => {
    expect(profileValuesSchema.safeParse({ timezone: 'Europe/Paris', heartRateZones: { running: [120, 140, 160, 180], cycling: [] } }).success).toBe(true);
    expect(profileValuesSchema.safeParse({ timezone: 'Invented/Place' }).success).toBe(false);
    expect(profileValuesSchema.safeParse({ heartRateZones: { running: [140, 130], cycling: [] } }).success).toBe(false);
    expect(profileValuesSchema.safeParse({ heartRateZones: { running: [140, 140], cycling: [] } }).success).toBe(false);
    expect(profileValuesSchema.safeParse({ weeklyAvailability: { monday: 90000 } }).success).toBe(false);
  });
});
