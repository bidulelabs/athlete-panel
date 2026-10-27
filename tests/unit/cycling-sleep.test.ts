import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  emptyWorkspace,
  healthRecordSchema,
  workoutSchema,
  type Completion,
} from '@athlete-panel/contracts';
import { summarizeCyclingSleep } from '../../personal-plugins/cycling-sleep/projection';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const activity = (
  value: number,
  localDate: string,
  durationSeconds: number | null,
  sport = 'cycling',
) =>
  activitySchema.parse({
    id: id(value),
    revision: 1,
    provider: 'garmin',
    externalId: `synthetic-${value}`,
    title: 'Synthetic activity',
    sport,
    startedAt: `${localDate}T06:00:00Z`,
    localDate,
    dateSource: 'provider',
    durationSeconds,
    distanceMeters: null,
    elevationMeters: null,
    averageHeartRateBpm: null,
  });
const sleep = (value: number, localDate: string, seconds: number | null) =>
  healthRecordSchema.parse({
    id: id(value),
    revision: 1,
    provider: 'garmin',
    externalId: `sleep-${localDate}`,
    localDate,
    metric: 'sleepDurationSeconds',
    measuredAt: null,
    value: seconds,
  });
const workout = (value: number, completion: Completion | null, sport = 'cycling') =>
  workoutSchema.parse({
    id: id(value),
    revision: 1,
    title: 'Synthetic workout',
    sport,
    schedule: { kind: 'independent', date: '2026-10-01' },
    completion,
  });
const manual = (
  performedDate: string,
  durationSeconds: number | null,
  status: 'completed' | 'partial' | 'skipped' = 'completed',
): Completion => ({
  status,
  source: 'manual',
  performedDate,
  durationSeconds,
  distanceMeters: null,
  activityId: null,
  rpe: null,
  reason: status === 'partial' ? 'Shortened session' : '',
});

describe('personal cycling and sleep projection', () => {
  it('distinguishes no sessions, unknown duration and measured zero without inventing sleep', () => {
    const state = emptyWorkspace();
    const empty = summarizeCyclingSleep(state, '2026-10-19', '2026-10-21');
    expect(empty.cycling).toEqual({ value: 0, knownCount: 0, missingCount: 0, sessions: 0 });
    expect(empty.sleep).toEqual({ averageSeconds: null, recordedNights: 0, missingNights: 3 });
    state.activities.push(activity(1, '2026-10-19', null), activity(2, '2026-10-20', 0));
    state.health.push(sleep(3, '2026-10-19', null), sleep(4, '2026-10-20', 0));
    const summary = summarizeCyclingSleep(state, '2026-10-19', '2026-10-21');
    expect(summary.dailyCycling[0]).toEqual({
      value: null,
      knownCount: 0,
      missingCount: 1,
      sessions: 1,
    });
    expect(summary.dailyCycling[1]).toEqual({
      value: 0,
      knownCount: 1,
      missingCount: 0,
      sessions: 1,
    });
    expect(summary.dailyCycling[2]).toEqual({
      value: 0,
      knownCount: 0,
      missingCount: 0,
      sessions: 0,
    });
    expect(summary.cycling).toEqual({ value: 0, knownCount: 1, missingCount: 1, sessions: 2 });
    expect(summary.dailySleep).toEqual([null, 0, null]);
    expect(summary.sleep).toEqual({ averageSeconds: 0, recordedNights: 1, missingNights: 2 });
  });

  it('counts linked cycling once and uses manual performed dates while excluding skipped and running sessions', () => {
    const state = emptyWorkspace();
    state.activities.push(
      activity(1, '2026-10-20', 3600),
      activity(2, '2026-10-20', 7200, 'running'),
    );
    state.workouts.push(
      workout(3, { ...manual('2026-10-20', 3600), source: 'garmin', activityId: id(1) }),
      workout(4, manual('2026-10-21', 1200, 'partial')),
      workout(5, manual('2026-10-21', null, 'skipped')),
      workout(6, manual('2026-10-21', 3600), 'running'),
      workout(7, manual('2026-10-22', 1800)),
      workout(8, null),
    );
    const summary = summarizeCyclingSleep(state, '2026-10-19', '2026-10-21');
    expect(summary.dailyCycling.map((value) => value.value)).toEqual([0, 3600, 1200]);
    expect(summary.cycling).toEqual({ value: 4800, knownCount: 2, missingCount: 0, sessions: 2 });
  });

  it('separates weekly boundaries and partial final weeks across a daylight-saving change', () => {
    const state = emptyWorkspace();
    state.activities.push(activity(1, '2026-10-25', 3600), activity(2, '2026-10-26', 1800));
    state.health.push(sleep(3, '2026-10-25', 28800), sleep(4, '2026-10-26', 25200));
    const summary = summarizeCyclingSleep(state, '2026-10-19', '2026-10-28');
    expect(summary.dates).toHaveLength(10);
    expect(new Set(summary.dates).size).toBe(10);
    expect(summary.weeks.map((week) => [week.startDate, week.endDate, week.cycling.value])).toEqual(
      [
        ['2026-10-19', '2026-10-25', 3600],
        ['2026-10-26', '2026-10-28', 1800],
      ],
    );
    expect(summary.weeks[0]?.sleep).toEqual({
      averageSeconds: 28800,
      recordedNights: 1,
      missingNights: 6,
    });
    expect(summary.weeks[1]?.sleep).toEqual({
      averageSeconds: 25200,
      recordedNights: 1,
      missingNights: 2,
    });
    expect(summary.sleep).toEqual({ averageSeconds: 27000, recordedNights: 2, missingNights: 8 });
  });
});
