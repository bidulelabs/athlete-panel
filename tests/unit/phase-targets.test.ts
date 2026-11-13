import { describe, expect, it } from 'vitest';
import { emptyWorkspace, periodSchema, type ChartsSummaryInput } from '@athlete-panel/contracts';
import { weekTargets } from '../../plugins/training/phase-targets';
import { chartsSummary } from '../../plugins/charts/summary';
import {
  hasSessionsOrTargets,
  hasTargets,
  trainingHoursBuckets,
} from '../../plugins/charts/training-hours';
import { climbingBuckets } from '../../plugins/charts/weekly-climbing';

const hours = (value: number) => value * 3600;
const marchBuild = periodSchema.parse({
  id: '30000000-0000-4000-8000-000000000001',
  revision: 1,
  name: 'March build',
  role: 'build',
  startDate: '2030-03-04',
  endDate: '2030-03-31',
  weeklyDurationSeconds: {
    firstWeek: { min: hours(8), max: hours(9) },
    lastWeek: { min: hours(11), max: hours(12) },
  },
  weeklyElevationGainMeters: {
    firstWeek: { min: 1000, max: 1200 },
    lastWeek: { min: 1600, max: 1800 },
  },
});
const workspace = () => ({ ...emptyWorkspace(), periods: [marchBuild] });
const summary = (input: Partial<ChartsSummaryInput>) =>
  chartsSummary(workspace(), {
    template: 'training-hours',
    weekStart: '2030-03-04',
    weeks: 4,
    ...input,
  } as ChartsSummaryInput);
const targetHours = (input: Partial<ChartsSummaryInput>) =>
  summary(input).volume!.buckets.map(
    (bucket) =>
      bucket.targetSeconds && [bucket.targetSeconds.min / 3600, bucket.targetSeconds.max / 3600],
  );

describe('phase week targets', () => {
  it('moves in a straight line from the first week to the last', () => {
    expect(
      ['2030-03-04', '2030-03-11', '2030-03-18', '2030-03-25'].map(
        (weekStart) => weekTargets([marchBuild], weekStart)!.weeklyDurationSeconds!.min / 3600,
      ),
    ).toEqual([8, 9, 10, 11]);
    expect(weekTargets([marchBuild], '2030-03-11')!.weeklyElevationGainMeters).toEqual({
      min: 1200,
      max: 1400,
    });
    expect(weekTargets([marchBuild], '2030-03-11')!.weeklyDistanceMeters).toBeNull();
  });

  it('gives a week to the period holding its first day, for any week start', () => {
    expect(weekTargets([marchBuild], '2030-03-03')).toBeNull();
    expect(weekTargets([marchBuild], '2030-03-10')!.weeklyDurationSeconds!.min).toBe(hours(8));
    expect(weekTargets([marchBuild], '2030-03-31')!.weeklyDurationSeconds!.min).toBe(hours(11));
    expect(weekTargets([marchBuild], '2030-04-01')).toBeNull();
  });

  it('uses the first week target for a one-week period', () => {
    const oneDay = { ...marchBuild, startDate: '2030-04-01', endDate: '2030-04-01' };
    expect(weekTargets([oneDay], '2030-04-01')!.weeklyDurationSeconds).toEqual({
      min: hours(8),
      max: hours(9),
    });
  });
});

describe('phase targets in charts', () => {
  it('sends each week its target and none for weeks outside every phase', () => {
    expect(targetHours({ weekStart: '2030-02-25', weeks: 3 })).toEqual([null, [8, 9], [9, 10]]);
  });

  it('sums a month from the days of each week inside it', () => {
    const [february, march, april] = targetHours({
      weekStart: '2030-02-24',
      weeks: 6,
      grouping: 'month',
    });
    expect(february).toBeNull();
    expect(march![0]).toBeCloseTo(8 + 9 + 10 + 11 / 7);
    expect(march![1]).toBeCloseTo(9 + 10 + 11 + 12 / 7);
    expect(april![0]).toBeCloseTo((11 * 6) / 7);
  });

  it('draws no target by day or for a sport selection, since targets count every sport', () => {
    expect(targetHours({ grouping: 'day' }).every((target) => target === null)).toBe(true);
    expect(targetHours({ sports: ['running'] }).every((target) => target === null)).toBe(true);
    expect(targetHours({ grouping: 'week' }).every((target) => target !== null)).toBe(true);
  });

  it('draws only the climbing target for a phase without an hours target', () => {
    const climbingOnly = {
      ...emptyWorkspace(),
      periods: [{ ...marchBuild, weeklyDurationSeconds: null }],
    };
    const input = { template: 'training-hours', weekStart: '2030-03-04', weeks: 4 } as const;
    const hours = chartsSummary(climbingOnly, input);
    expect(hours.volume!.buckets.every((bucket) => bucket.targetSeconds === null)).toBe(true);
    expect(hasTargets(trainingHoursBuckets(hours, '2030-03-01', String))).toBe(false);
    const climbing = chartsSummary(climbingOnly, { ...input, template: 'weekly-climbing' });
    expect(climbingBuckets(climbing, '2030-03-01', 'metric')[0]!.targetRange).toEqual([1000, 1200]);
  });

  it('shows hours and climbing targets in profile units and keeps a chart with only targets', () => {
    const hoursWeeks = trainingHoursBuckets(
      summary({}),
      '2030-03-01',
      (seconds) => `${seconds / 3600}h`,
    );
    expect(hoursWeeks[0]).toMatchObject({ targetRange: [8, 9], targetLabel: '8h–9h' });
    const climbing = climbingBuckets(
      summary({ template: 'weekly-climbing' }),
      '2030-03-01',
      'imperial',
    );
    expect(climbing[0]!.targetLabel).toBe('3,281 ft–3,937 ft');
    expect(hasSessionsOrTargets(summary({}))).toBe(true);
    expect(
      hasSessionsOrTargets(
        chartsSummary(emptyWorkspace(), {
          template: 'training-hours',
          weekStart: '2030-03-04',
          weeks: 4,
        }),
      ),
    ).toBe(false);
  });
});
