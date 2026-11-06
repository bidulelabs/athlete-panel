import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  chartsSports,
  chartsTemplates,
  chartsSummaryInputSchema,
  chartsSummarySchema,
  emptyWorkspace,
  workoutSchema,
} from '@athlete-panel/contracts';
import { bucketRanges } from '../../plugins/charts/bucket-ranges';
import { chartsSummary } from '../../plugins/charts/summary';
import { trainingHoursBuckets } from '../../plugins/charts/training-hours';
import { climbingBuckets } from '../../plugins/charts/weekly-climbing';
import { activity, plannedWorkout, trainingEvent } from '../fixtures/charts';

const selection = { template: 'training-hours', weekStart: '2028-02-20', weeks: 3 } as const;
function fixture() {
  const state = emptyWorkspace();
  state.activities = [
    activitySchema.parse({
      ...activity(8001, '2028-02-20', 3600),
      distanceMeters: 1000,
      elevationMeters: 100,
    }),
    activitySchema.parse({
      ...activity(8002, '2028-02-27', 7200),
      distanceMeters: 9000,
      elevationMeters: 90,
    }),
    activitySchema.parse({
      ...activity(8003, '2028-02-29', 1800),
      sport: 'cycling',
      distanceMeters: 20000,
      elevationMeters: 200,
    }),
    activitySchema.parse({ ...activity(8004, '2028-02-29', null), distanceMeters: 1000 }),
    activitySchema.parse({
      ...activity(8005, '2028-03-01', 0),
      distanceMeters: 1000,
      elevationMeters: 0,
    }),
    activitySchema.parse({
      ...activity(8006, '2028-02-26', 600),
      sport: 'running',
      sportResolution: 'unresolved',
    }),
  ];
  state.workouts = [
    plannedWorkout(8101, '2028-02-20', 5400),
    workoutSchema.parse({ ...plannedWorkout(8102, '2028-02-29', 3600), sport: 'cycling' }),
  ];
  state.events = [trainingEvent(8201, '2028-02-29', 'Leap day race')];
  return state;
}

describe('chart sport filters and grouping', () => {
  it('keeps Sunday week boundaries and the exact period across day/week/month, including leap day', () => {
    for (const grouping of ['day', 'week', 'month'] as const) {
      const ranges = bucketRanges(selection.weekStart, selection.weeks, grouping);
      expect(ranges[0]!.startDate).toBe('2028-02-20');
      expect(ranges.at(-1)!.endDate).toBe('2028-03-11');
    }
    expect(bucketRanges(selection.weekStart, 3, 'day')).toHaveLength(21);
    expect(bucketRanges(selection.weekStart, 3, 'week').map((b) => b.startDate)).toEqual([
      '2028-02-20',
      '2028-02-27',
      '2028-03-05',
    ]);
    expect(bucketRanges(selection.weekStart, 3, 'month')).toEqual([
      { startDate: '2028-02-20', endDate: '2028-02-29', partial: true },
      { startDate: '2028-03-01', endDate: '2028-03-11', partial: true },
    ]);
    expect(bucketRanges('2029-12-30', 2, 'month').map((b) => [b.startDate, b.endDate])).toEqual([
      ['2029-12-30', '2029-12-31'],
      ['2030-01-01', '2030-01-12'],
    ]);
  });

  it('returns only week dates outside the volume buckets for every template', () => {
    for (const template of chartsTemplates) {
      const summary = chartsSummary(fixture(), { ...selection, template });
      expect(chartsSummarySchema.parse(summary)).toEqual(summary);
      expect(summary.weeks).toEqual([
        { weekStart: '2028-02-20' },
        { weekStart: '2028-02-27' },
        { weekStart: '2028-03-05' },
      ]);
    }
  });

  it('filters planned and recorded totals alike while retaining the selected week dates', () => {
    const state = fixture();
    const summary = chartsSummary(state, { ...selection, grouping: 'month', sports: ['running'] });
    expect(chartsSummarySchema.parse(summary)).toEqual(summary);
    const feb = summary.volume!.buckets[0]!;
    expect(feb.plannedSeconds).toEqual({ value: 5400, knownCount: 1, missingCount: 0 });
    expect(feb.recordedSeconds).toEqual({ value: 10800, knownCount: 2, missingCount: 1 });
    expect(feb.recordedSecondsBySport.cycling).toEqual({
      value: 0,
      knownCount: 0,
      missingCount: 0,
    });
    expect(summary.weeks).toEqual(chartsSummary(state, selection).weeks);
    expect(summary.races).toHaveLength(1);
  });

  it('preserves totals and missing counts across every grouping and multi-sport selections', () => {
    for (const sports of [['running'], ['running', 'cycling'], [...chartsSports]] as const) {
      const totals = ['day', 'week', 'month'].map((grouping) => {
        const input = chartsSummaryInputSchema.parse({ ...selection, grouping, sports });
        return chartsSummary(fixture(), input).volume!.buckets.reduce(
          (sum, b) => ({
            recorded: sum.recorded + (b.recordedSeconds.value ?? 0),
            planned: sum.planned + (b.plannedSeconds.value ?? 0),
            missing: sum.missing + b.recordedSeconds.missingCount,
            known: sum.known + b.recordedSeconds.knownCount,
          }),
          { recorded: 0, planned: 0, missing: 0, known: 0 },
        );
      });
      expect(totals[0]).toEqual(totals[1]);
      expect(totals[1]).toEqual(totals[2]);
    }
    const other = chartsSummary(fixture(), { ...selection, sports: ['other'] });
    expect(other.volume!.buckets[0]!.recordedSeconds.value).toBe(600);
  });

  it('uses the paired ascent/distance totals, not the average of ratios, and excludes unmeasured runs', () => {
    const summary = chartsSummary(fixture(), {
      ...selection,
      template: 'weekly-climbing',
      grouping: 'month',
      sports: ['running'],
    });
    expect(summary.volume!.buckets[0]!.runningClimb).toEqual({
      sessionCount: 3,
      measuredSessionCount: 2,
      elevationMeters: 190,
      distanceMeters: 10000,
    });
    expect(climbingBuckets(summary, '2028-03-12', 'metric')[0]!.runningClimbLabel).toBe(
      '19 m/km (partial)',
    );
    const cycling = chartsSummary(fixture(), {
      ...selection,
      template: 'weekly-climbing',
      sports: ['cycling'],
    });
    expect(cycling.volume!.buckets.every((b) => b.runningClimb.sessionCount === 0)).toBe(true);
  });

  it('distinguishes missing, empty, known-zero, current and future days after filtering', () => {
    const summary = chartsSummary(fixture(), {
      ...selection,
      grouping: 'day',
      sports: ['running'],
    });
    const rows = trainingHoursBuckets(summary, '2028-03-01', (seconds) => `${seconds / 60}m`);
    expect(rows.find((r) => r.startDate === '2028-02-29')).toMatchObject({
      recordedHours: null,
      recordedLabel: 'Duration missing',
      races: ['Leap day race'],
    });
    expect(rows.find((r) => r.startDate === '2028-02-28')).toMatchObject({
      recordedHours: null,
      recordedLabel: 'No sessions recorded',
    });
    expect(rows.find((r) => r.startDate === '2028-03-01')).toMatchObject({
      recordedHours: 0,
      recordedLabel: '0m',
      inProgress: true,
    });
    expect(rows.find((r) => r.startDate === '2028-03-02')).toMatchObject({
      recordedHours: null,
      recordedLabel: 'Upcoming',
    });
  });

  it('uses performed dates for manual workouts and counts a linked activity once', () => {
    const state = fixture();
    state.workouts.push(
      workoutSchema.parse({
        ...plannedWorkout(8103, '2028-02-25', 1800),
        completion: {
          status: 'completed',
          source: 'manual',
          activityId: null,
          performedDate: '2028-03-01',
          durationSeconds: 1200,
          distanceMeters: null,
        },
      }),
    );
    state.workouts.push(
      workoutSchema.parse({
        ...plannedWorkout(8104, '2028-02-27', 7200),
        completion: {
          status: 'completed',
          source: 'garmin',
          activityId: state.activities[1]!.id,
          performedDate: '2028-02-27',
          durationSeconds: 7200,
          distanceMeters: 9000,
        },
      }),
    );
    const buckets = chartsSummary(state, { ...selection, grouping: 'month', sports: ['running'] })
      .volume!.buckets;
    expect(buckets[0]!.recordedSeconds.value).toBe(10800);
    expect(buckets[1]!.recordedSeconds).toEqual({ value: 1200, knownCount: 2, missingCount: 0 });
  });

  it('keeps full months unmarked and clips the last month, with a bounded daily response', () => {
    expect(bucketRanges('2030-04-01', 9, 'month')).toEqual([
      { startDate: '2030-04-01', endDate: '2030-04-30', partial: false },
      { startDate: '2030-05-01', endDate: '2030-05-31', partial: false },
      { startDate: '2030-06-01', endDate: '2030-06-02', partial: true },
    ]);
    expect(bucketRanges('2028-01-02', 53, 'day')).toHaveLength(371);
  });

  it('rejects empty/duplicate/unknown sports and unsupported template controls', () => {
    for (const sports of [[], ['running', 'running'], ['bad']])
      expect(chartsSummaryInputSchema.safeParse({ ...selection, sports }).success).toBe(false);
    for (const template of [
      'workout-heart-rate',
      'resting-heart-rate-hrv',
      'estimated-training-load',
    ]) {
      expect(
        chartsSummaryInputSchema.safeParse({ ...selection, template, grouping: 'week' }).success,
      ).toBe(false);
      expect(
        chartsSummaryInputSchema.safeParse({ ...selection, template, sports: ['running'] }).success,
      ).toBe(false);
      expect(
        chartsSummary(fixture(), chartsSummaryInputSchema.parse({ ...selection, template })).volume,
      ).toBeNull();
    }
  });
});
