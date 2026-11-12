import { describe, expect, it } from 'vitest';
import { printableWeekFixture } from '../fixtures/printable-week';
import { printableWeek } from '../../personal-plugins/printable-training-week/week';
import {
  printDistance,
  printElevation,
  printLength,
  printTarget,
  printTime,
  printWeight,
} from '../../personal-plugins/printable-training-week/format';

describe('printable planned week', () => {
  it('resolves plan dates, preserves session order and ignores completion dates and unscheduled plans', () => {
    const data = printableWeekFixture();
    const original = structuredClone(data);
    const week = printableWeek(data, '2030-01-09', 1);
    expect(week.map((day) => day.date)).toEqual([
      '2030-01-07',
      '2030-01-08',
      '2030-01-09',
      '2030-01-10',
      '2030-01-11',
      '2030-01-12',
      '2030-01-13',
    ]);
    expect(week[0].sessions.map((entry) => entry.workout.title)).toEqual([
      'Morning intervals',
      'Evening strength',
    ]);
    expect(week[0].sessions[0].planTitle).toBe('Winter base');
    expect(week[0].sessions[0].workout.durationSeconds).toBe(2705);
    expect(week.flatMap((day) => day.sessions)).toHaveLength(5);
    expect(week[1].sessions).toEqual([]);
    expect(week[3].sessions[0].workout.kind).toBe('rest');
    expect(data).toEqual(original);
  });
  it('uses Sunday boundaries and floating dates over DST and year changes', () => {
    const data = printableWeekFixture();
    const sunday = printableWeek(data, '2030-01-09', 0);
    expect(sunday[0].date).toBe('2030-01-06');
    expect(sunday[6].date).toBe('2030-01-12');
    expect(sunday.flatMap((day) => day.sessions)).toHaveLength(4);
    expect(printableWeek(data, '2030-03-31', 1).map((day) => day.date)).toEqual([
      '2030-03-25',
      '2030-03-26',
      '2030-03-27',
      '2030-03-28',
      '2030-03-29',
      '2030-03-30',
      '2030-03-31',
    ]);
    const crossing = printableWeek(data, '2030-01-01', 1);
    expect([crossing[0].date, crossing[6].date]).toEqual(['2029-12-31', '2030-01-06']);
    expect(crossing.every((day) => !day.sessions.length)).toBe(true);
  });
});

it('keeps unknown and zero distinct and prints precise prescribed units and targets', () => {
  expect(printTime(null)).toBe('Not specified');
  expect(printTime(0)).toBe('0 sec');
  expect(printTime(2705)).toBe('45 min 5 sec');
  expect(printDistance(400, 'metric')).toBe('400 m');
  expect(printDistance(1609.344, 'imperial')).toBe('1 mi');
  expect(printWeight(0, 'imperial')).toBe('0 lb');
  expect(printWeight(20, 'imperial')).toBe('44.092 lb');
  expect(printElevation(0, 'metric')).toBe('0 m ascent');
  expect(printTarget({ kind: 'paceSecondsPerKilometer', min: 300, max: 330 }, 'metric')).toBe(
    '5:00–5:30 / km',
  );
  expect(printTarget({ kind: 'paceSecondsPerKilometer', min: 300, max: 300 }, 'imperial')).toBe(
    '8:03 / mi',
  );
  expect(printTarget({ kind: 'heartRateBpm', min: 120, max: 140 }, 'metric')).toBe('120–140 bpm');
  expect(printTarget({ kind: 'powerWatts', min: 200, max: 200 }, 'metric')).toBe('200 W');
  expect(printTarget({ kind: 'rpe', min: 4, max: 6 }, 'metric')).toBe('RPE 4–6 / 10');
  expect(
    printLength(
      {
        kind: 'warmup',
        durationSeconds: null,
        distanceMeters: null,
        endsOnLapButton: true,
        target: null,
        notes: '',
      },
      'metric',
    ),
  ).toBe('Until lap button');
});
