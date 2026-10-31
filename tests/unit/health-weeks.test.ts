import { describe, expect, it } from 'vitest';
import {
  healthMetricSchema,
  healthRecordSchema,
  profileSchema,
  type HealthRecord,
} from '@athlete-panel/contracts';
import { recentHealthAndWeeklyAverages } from '../../plugins/agent-bridge/health-weeks';
import { addDays } from '../../plugins/training/public/shared';

const today = '2026-10-31';
const sixWeeks = { from: '2026-09-20', to: '2026-10-31' };
let nextId = 1;
const record = (
  localDate: string,
  metric: HealthRecord['metric'],
  value: number | null,
  account = '555',
  revision = 1,
) =>
  healthRecordSchema.parse({
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    revision,
    provider: 'garmin',
    externalId: `${account}:daily:${localDate}:${metric}:${nextId}`,
    metric,
    localDate,
    measuredAt: `${localDate}T06:30:00.000Z`,
    value,
    provenance: { sourceAccountId: account, source: 'daily' },
  });
const profile = (weekStartsOnPreference?: 'auto' | 'monday' | 'sunday') =>
  profileSchema.parse({ id: 'owner', revision: 1, weekStartsOnPreference });
const weeks = (
  health: HealthRecord[],
  scope = sixWeeks,
  weekStartsOnPreference?: 'auto' | 'monday' | 'sunday',
) =>
  recentHealthAndWeeklyAverages({ profile: profile(weekStartsOnPreference), health }, scope, today);
const everyDay = (from: string, to: string) => {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
};

describe('agent health context', () => {
  it('keeps today and the six days before as daily records and moves the seventh day back into a week', () => {
    const result = weeks([
      record('2026-10-24', 'steps', 7000),
      record('2026-10-25', 'steps', 9000),
    ]);
    expect(result.health.map((r) => r.localDate)).toEqual(['2026-10-25']);
    expect(result.healthWeeks.at(-1)).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-24',
      days: 6,
      metrics: { steps: { average: 7000, days: 1 } },
    });
  });

  it('clips partial weeks at the grant start and before the daily window', () => {
    expect(weeks([]).healthWeeks.map(({ from, to, days }) => ({ from, to, days }))).toEqual([
      { from: '2026-09-20', to: '2026-09-20', days: 1 },
      { from: '2026-09-21', to: '2026-09-27', days: 7 },
      { from: '2026-09-28', to: '2026-10-04', days: 7 },
      { from: '2026-10-05', to: '2026-10-11', days: 7 },
      { from: '2026-10-12', to: '2026-10-18', days: 7 },
      { from: '2026-10-19', to: '2026-10-24', days: 6 },
    ]);
  });

  it.each([
    { preference: 'sunday' as const, firstWeek: { from: '2026-09-20', to: '2026-09-26' } },
    { preference: 'monday' as const, firstWeek: { from: '2026-09-20', to: '2026-09-20' } },
    { preference: 'auto' as const, firstWeek: { from: '2026-09-20', to: '2026-09-20' } },
    { preference: undefined, firstWeek: { from: '2026-09-20', to: '2026-09-20' } },
  ])('starts weeks from the $preference profile preference', ({ preference, firstWeek }) => {
    const result = weeks([], sixWeeks, preference);
    expect(result.healthWeeks[0]).toMatchObject(firstWeek);
    expect(result.healthWeeks.at(-1)).toMatchObject({ to: '2026-10-24' });
  });

  it('reports every metric of a week without data as unknown, never zero', () => {
    const result = weeks([record('2026-09-30', 'steps', 8000)]);
    const empty = result.healthWeeks.find((week) => week.from === '2026-10-05')!;
    expect(Object.keys(empty.metrics)).toEqual(healthMetricSchema.options);
    for (const metric of Object.values(empty.metrics))
      expect(metric).toEqual({ average: null, days: 0 });
  });

  it('averages only the days with a known value and counts them', () => {
    const result = weeks([
      record('2026-10-05', 'hrvMilliseconds', 40),
      record('2026-10-06', 'hrvMilliseconds', 45),
      record('2026-10-07', 'hrvMilliseconds', null),
      record('2026-10-08', 'sleepDurationSeconds', 25200),
    ]);
    const week = result.healthWeeks.find((w) => w.from === '2026-10-05')!;
    expect(week.metrics.hrvMilliseconds).toEqual({ average: 43, days: 2 });
    expect(week.metrics.sleepDurationSeconds).toEqual({ average: 25200, days: 1 });
    expect(week.metrics.bodyBattery).toEqual({ average: null, days: 0 });
  });

  it('leaves out a day that two Garmin accounts both recorded', () => {
    const result = weeks([
      record('2026-10-05', 'restingHeartRateBpm', 48, '555'),
      record('2026-10-05', 'restingHeartRateBpm', 60, '777'),
      record('2026-10-06', 'restingHeartRateBpm', 50, '555'),
    ]);
    expect(
      result.healthWeeks.find((w) => w.from === '2026-10-05')!.metrics.restingHeartRateBpm,
    ).toEqual({ average: 50, days: 1 });
  });

  it.each([
    { corrected: 60, expected: { average: 60, days: 1 }, reversed: false },
    { corrected: 60, expected: { average: 60, days: 1 }, reversed: true },
    { corrected: null, expected: { average: null, days: 0 }, reversed: false },
    { corrected: null, expected: { average: null, days: 0 }, reversed: true },
  ])(
    'uses the latest revision when one account corrects 40 to $corrected (reversed input: $reversed)',
    ({ corrected, expected, reversed }) => {
      const original = record('2026-10-05', 'hrvMilliseconds', 40, '555', 1);
      const correction = record('2026-10-05', 'hrvMilliseconds', corrected, '555', 2);
      const result = weeks(reversed ? [correction, original] : [original, correction], {
        from: '2026-10-05',
        to: '2026-10-11',
      });
      expect(result.healthWeeks[0]!.metrics.hrvMilliseconds).toEqual(expected);
    },
  );

  it('keeps the other account value when one of two accounts corrects its day to unknown', () => {
    const result = weeks([
      record('2026-10-05', 'restingHeartRateBpm', 48, '555', 1),
      record('2026-10-05', 'restingHeartRateBpm', null, '555', 2),
      record('2026-10-05', 'restingHeartRateBpm', 60, '777'),
    ]);
    expect(
      result.healthWeeks.find((w) => w.from === '2026-10-05')!.metrics.restingHeartRateBpm,
    ).toEqual({ average: 60, days: 1 });
  });

  it('returns no week when the grant starts inside the daily window', () => {
    const result = weeks([record('2026-10-28', 'steps', 5000)], {
      from: '2026-10-26',
      to: '2026-11-08',
    });
    expect(result.healthWeeks).toEqual([]);
    expect(result.health).toHaveLength(1);
  });

  it('returns only weeks when the grant ends before the daily window', () => {
    const result = weeks([record('2026-10-01', 'steps', 5000)], {
      from: '2026-09-28',
      to: '2026-10-11',
    });
    expect(result.health).toEqual([]);
    expect(result.healthWeeks.map((w) => [w.from, w.to])).toEqual([
      ['2026-09-28', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
    ]);
  });

  it('cuts the health part of a six-week context by more than three quarters', () => {
    const health = everyDay(sixWeeks.from, sixWeeks.to).flatMap((date, day) =>
      healthMetricSchema.options.map((metric, index) => record(date, metric, 1000 + day + index)),
    );
    const before = JSON.stringify({ health }).length;
    const after = JSON.stringify(weeks(health)).length;
    expect(before).toBeGreaterThan(100_000);
    expect(after).toBeLessThan(before / 4);
  });
});
