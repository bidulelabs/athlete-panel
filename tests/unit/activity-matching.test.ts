import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  completionInputSchema,
  emptyWorkspace,
  planSchema,
  profileSchema,
  workoutSchema,
} from '@athlete-panel/contracts';
import {
  automaticActivityMatches,
  isLinkableWorkout,
} from '../../plugins/training/activity-matching';
import { applyCommands } from '../../plugins/training/engine';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-24';
function fixture() {
  const state = emptyWorkspace();
  state.profile = profileSchema.parse({ id: 'owner', revision: 1, timezone: 'Europe/Paris' });
  state.workouts = [
    workoutSchema.parse({
      id: id(1),
      revision: 1,
      title: 'Run',
      sport: 'running',
      schedule: { kind: 'independent', date },
      durationSeconds: 3600,
    }),
  ];
  state.activities = [
    activitySchema.parse({
      id: id(2),
      revision: 1,
      provider: 'garmin',
      externalId: '555:2',
      title: 'Run',
      sport: 'running',
      sportSubgroup: 'trail_running',
      sportResolution: 'resolved',
      startedAt: '2026-10-23T23:30:00Z',
      localDate: date,
      dateSource: 'provider',
      durationSeconds: 3000,
      distanceMeters: 9000,
      elevationMeters: null,
      averageHeartRateBpm: null,
    }),
  ];
  return state;
}
const match = (state = fixture(), ids = [id(2)]) =>
  automaticActivityMatches(state, new Set(ids), date);

describe('automatic activity matching', () => {
  it('uses normalized local dates and allows a subtype for a general sport', () => {
    expect(match()).toEqual([
      { action: 'workout.link', id: id(1), activityId: id(2), expectedRevision: 1 },
    ]);
    expect(match(fixture(), [])).toEqual([]);
  });
  it('requires unique candidates on both sides, including older ineligible activities', () => {
    const state = fixture();
    state.activities.push({ ...state.activities[0]!, id: id(3), externalId: '555:3' });
    expect(match(state)).toEqual([]);
    state.activities.pop();
    state.workouts.push({ ...state.workouts[0]!, id: id(4) });
    expect(match(state)).toEqual([]);
    state.workouts.reverse();
    expect(match(state)).toEqual([]);
  });
  it('never resolves overlapping general/specific candidates by greedy iteration', () => {
    const state = fixture();
    state.workouts.push({ ...state.workouts[0]!, id: id(3), sportSubgroup: 'trail_running' });
    state.activities.push({
      ...state.activities[0]!,
      id: id(4),
      externalId: '555:4',
      sportSubgroup: null,
    });
    expect(match(state, [id(2), id(4)])).toEqual([]);
  });
  it('uses performed date for manual logs and preserves partial status and annotations', () => {
    const state = fixture();
    state.workouts[0] = workoutSchema.parse({
      ...state.workouts[0],
      schedule: { kind: 'independent', date: '2026-10-23' },
      completion: {
        status: 'partial',
        source: 'manual',
        activityId: null,
        performedDate: date,
        durationSeconds: 1000,
        distanceMeters: 2000,
        rpe: 7,
        reason: 'Stopped early',
        notes: 'Keep this note',
      },
    });
    const result = applyCommands(state, match(state), { actor: 'owner', linkMethod: 'automatic' });
    expect(result.state.workouts[0]?.completion).toMatchObject({
      status: 'partial',
      source: 'garmin',
      linkMethod: 'automatic',
      durationSeconds: 3000,
      distanceMeters: 9000,
      rpe: 7,
      reason: 'Stopped early',
      notes: 'Keep this note',
    });
    const edited = applyCommands(
      result.state,
      [
        {
          action: 'workout.complete',
          id: id(1),
          expectedRevision: 2,
          values: {
            status: 'partial',
            performedDate: date,
            reason: 'Still partial',
            notes: 'Edited',
          },
        },
      ],
      { actor: 'owner' },
    );
    expect(edited.state.workouts[0]?.completion?.linkMethod).toBe('automatic');
  });
  it('preserves automatic provenance when an owner repeats the same link through the API command', () => {
    const linked = applyCommands(fixture(), match(), { actor: 'owner', linkMethod: 'automatic' });
    const workout = linked.state.workouts[0]!;
    const repeated = applyCommands(
      linked.state,
      [
        {
          action: 'workout.link',
          id: workout.id,
          expectedRevision: workout.revision,
          activityId: id(2),
        },
      ],
      { actor: 'owner' },
    );
    expect(repeated.state.workouts[0]?.completion?.linkMethod).toBe('automatic');
    expect(repeated.state.workouts[0]?.completion).toEqual(workout.completion);
  });
  it('does not substitute the scheduled day for a different performed date', () => {
    const state = fixture();
    state.workouts[0] = workoutSchema.parse({
      ...state.workouts[0],
      completion: {
        status: 'completed',
        source: 'manual',
        activityId: null,
        performedDate: '2026-10-23',
      },
    });
    // Manual selection remains available across dates; only automatic matching requires same day.
    expect(isLinkableWorkout(state.workouts[0], state.plans)).toBe(true);
    expect(match(state)).toEqual([]);
  });
  it('respects exact subtypes and unresolved sports', () => {
    const state = fixture();
    state.workouts[0]!.sportSubgroup = 'treadmill_running';
    expect(match(state)).toEqual([]);
    state.workouts[0]!.sportSubgroup = 'trail_running';
    expect(match(state)).toHaveLength(1);
    state.activities[0]!.sportResolution = 'unresolved';
    expect(match(state)).toEqual([]);
  });
  it('excludes future, rest, skipped, unscheduled and already linked sessions', () => {
    const state = fixture();
    expect(automaticActivityMatches(state, new Set([id(2)]), '2026-10-23')).toEqual([]);
    state.workouts[0] = workoutSchema.parse({
      ...state.workouts[0],
      kind: 'rest',
      sport: null,
      durationSeconds: null,
    });
    expect(match(state)).toEqual([]);
    state.workouts[0] = workoutSchema.parse({
      ...fixture().workouts[0],
      completion: { status: 'skipped', source: 'manual', activityId: null, performedDate: date },
    });
    expect(match(state)).toEqual([]);
    state.plans = [planSchema.parse({ id: id(9), revision: 1, title: 'Unscheduled' })];
    state.workouts[0] = workoutSchema.parse({
      ...fixture().workouts[0],
      schedule: { kind: 'plan', planId: id(9), day: 1 },
    });
    expect(match(state)).toEqual([]);
    const linked = applyCommands(fixture(), match(), { actor: 'owner' }).state;
    expect(match(linked)).toEqual([]);
  });
  it('does not accept client-supplied linking provenance', () => {
    expect(
      completionInputSchema.safeParse({
        status: 'completed',
        performedDate: date,
        linkMethod: 'automatic',
      }).success,
    ).toBe(false);
  });
});
