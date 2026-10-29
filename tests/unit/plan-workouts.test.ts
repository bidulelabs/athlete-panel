import { describe, expect, it } from 'vitest';
import { workoutSchema } from '@athlete-panel/contracts';
import { planWeeks, plannedDuration } from '../../plugins/training/plan-workouts';
import { plansFixture } from '../fixtures/plans';

describe('plan schedule presentation', () => {
  it('keeps seven-day plan boundaries, gaps and within-day order without mutating input', () => {
    const data = plansFixture();
    const workouts = data.workouts.slice(0, 9).reverse();
    const before = structuredClone(workouts);
    const weeks = planWeeks(workouts);
    expect(weeks.map(({ week, days }) => [week, days.map(([day]) => day)])).toEqual([
      [1, [1, 2, 3, 4, 6]],
      [2, [8, 10, 14]],
    ]);
    expect(weeks[0]!.days[1]![1].map((workout) => workout.title)).toEqual([
      'Threshold intervals',
      'Strength & stability',
    ]);
    const boundary = workoutSchema.parse({
      ...data.workouts[0],
      schedule: { kind: 'plan', planId: data.plans[0]!.id, day: 15 },
    });
    expect(planWeeks([boundary])[0]!.week).toBe(3);
    expect(workouts).toEqual(before);
  });

  it('keeps known, unknown, zero and rest durations distinct', () => {
    const data = plansFixture();
    expect(plannedDuration(data.workouts.slice(0, 9))).toEqual({
      seconds: 26400,
      missing: 1,
      sessions: 8,
      rests: 1,
    });
    expect(plannedDuration([data.workouts[6]!])).toEqual({
      seconds: null,
      missing: 1,
      sessions: 1,
      rests: 0,
    });
    expect(plannedDuration([{ ...data.workouts[0]!, durationSeconds: 0 }])).toEqual({
      seconds: 0,
      missing: 0,
      sessions: 1,
      rests: 0,
    });
    expect(plannedDuration([data.workouts[3]!])).toEqual({
      seconds: null,
      missing: 0,
      sessions: 0,
      rests: 1,
    });
    expect(plannedDuration([])).toEqual({ seconds: null, missing: 0, sessions: 0, rests: 0 });
  });
});
