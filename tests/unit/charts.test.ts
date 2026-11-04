import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  chartsSummaryInputSchema,
  emptyWorkspace,
  planSchema,
  workoutSchema,
} from '@athlete-panel/contracts';
import { nightRows } from '../../plugins/charts/resting-heart-rate-hrv';
import { seasonStart } from '../../plugins/charts/season';
import { chartsSummary } from '../../plugins/charts/summary';
import { hasSessions, trainingHoursWeeks } from '../../plugins/charts/training-hours';
import { recordedSports, trainingBySportWeeks } from '../../plugins/charts/training-by-sport';
import { climbingWeeks } from '../../plugins/charts/weekly-climbing';
import {
  sportWithMostHeartRate,
  heartRateSessions,
  sportsWithHeartRate,
} from '../../plugins/charts/workout-heart-rate';
import { addDays, weeklySummary } from '../../plugins/training/public/shared';
import {
  activity,
  chartsWorkspace,
  mixedSportsWorkspace,
  chartsFirstWeek,
  chartsId,
  chartsToday,
  nightRecord,
  trainingEvent,
} from '../fixtures/charts';

const minutes = (seconds: number) => `${seconds / 60}m`;
const selection = { template: 'training-hours', weekStart: chartsFirstWeek, weeks: 14 } as const;

describe('charts weekly summary', () => {
  it('returns the same planned and recorded duration as each Calendar week', () => {
    const data = chartsWorkspace();
    const summary = chartsSummary(data, selection);
    expect(summary.weeks).toHaveLength(14);
    summary.weeks.forEach((week, index) => {
      const calendar = weeklySummary(data, addDays(chartsFirstWeek, index * 7));
      expect(week).toMatchObject({
        weekStart: calendar.startDate,
        plannedSeconds: calendar.planned.durationSeconds,
        recordedSeconds: calendar.actual.durationSeconds,
      });
    });
  });

  it('keeps only races inside the selected weeks', () => {
    const data = chartsWorkspace();
    data.events.push(trainingEvent(303, addDays(chartsFirstWeek, 14 * 7), 'Spring marathon'));
    expect(chartsSummary(data, selection).races.map((item) => item.title)).toEqual([
      'Hill 15 km',
      'New Year 10 km',
    ]);
  });

  it('tells a week without sessions from a missing duration, a partial week and an upcoming week', () => {
    const data = chartsWorkspace();
    data.activities.push(activity(400, addDays(chartsFirstWeek, 12 * 7 + 1), 3600));
    const weeks = trainingHoursWeeks(chartsSummary(data, selection), chartsToday, minutes);
    expect(weeks[2]).toMatchObject({ recordedHours: null, recordedLabel: 'No sessions recorded' });
    expect(weeks[10]).toMatchObject({
      recordedHours: 0.5,
      recordedLabel: '30m (1 of 2 sessions without duration)',
    });
    expect(weeks[11]).toMatchObject({ inProgress: false, recordedHours: 2, recordedLabel: '120m' });
    expect(weeks[12]).toMatchObject({
      inProgress: true,
      recordedHours: 1,
      recordedLabel: '60m',
      plannedLabel: 'No plan',
    });
    expect(weeks[13]).toMatchObject({
      inProgress: false,
      recordedHours: null,
      recordedLabel: 'Upcoming',
      plannedHours: null,
      plannedLabel: 'No plan',
    });
    expect(weeks[5]).toMatchObject({
      plannedHours: 8,
      plannedLabel: '480m',
      races: ['Hill 15 km'],
    });
  });

  it('reports a session measured at zero as 0m, not as a week without sessions', () => {
    const data = chartsWorkspace();
    data.activities.push(activity(401, addDays(chartsFirstWeek, 2 * 7 + 2), 0));
    const weeks = trainingHoursWeeks(chartsSummary(data, selection), chartsToday, minutes);
    expect(weeks[2]).toMatchObject({ recordedHours: 0, recordedLabel: '0m' });
  });

  it('reports a week where every recorded duration is missing as missing, not zero', () => {
    const data = chartsWorkspace();
    data.activities = [activity(500, addDays(chartsFirstWeek, 1), null)];
    const [week] = trainingHoursWeeks(chartsSummary(data, selection), chartsToday, minutes);
    expect(week).toMatchObject({ recordedHours: null, recordedLabel: 'Duration missing' });
  });

  it('reports an empty selection as having no training', () => {
    expect(hasSessions(chartsSummary(emptyWorkspace(), selection))).toBe(false);
    expect(hasSessions(chartsSummary(chartsWorkspace(), selection))).toBe(true);
  });

  it('accepts one to 53 weeks', () => {
    for (const weeks of [1, 53])
      expect(chartsSummaryInputSchema.safeParse({ ...selection, weeks }).success).toBe(true);
    for (const weeks of [0, 54, 1.5])
      expect(chartsSummaryInputSchema.safeParse({ ...selection, weeks }).success).toBe(false);
  });
});

describe('charts season', () => {
  const planWithLastDay = (id: number, startDate: string, lastDay: number) => {
    const data = emptyWorkspace();
    data.plans = [
      planSchema.parse({ id: chartsId(id), revision: 1, title: 'Spring trail', startDate }),
    ];
    data.workouts = [
      workoutSchema.parse({
        id: chartsId(id + 1),
        revision: 1,
        title: 'Long run',
        sport: 'running',
        schedule: { kind: 'plan', planId: chartsId(id), day: lastDay },
      }),
    ];
    return data;
  };

  it('starts on the start date of the plan running today', () => {
    expect(seasonStart(planWithLastDay(800, '2029-11-05', 120), chartsToday)).toBe('2029-11-05');
  });

  it('starts on 1 January without a plan', () => {
    expect(seasonStart(emptyWorkspace(), chartsToday)).toBe('2030-01-01');
  });

  it('starts on 1 January when the plan starts later or has already ended', () => {
    expect(seasonStart(planWithLastDay(810, '2030-02-01', 120), chartsToday)).toBe('2030-01-01');
    expect(seasonStart(planWithLastDay(820, '2029-09-03', 60), chartsToday)).toBe('2030-01-01');
  });
});

describe('charts training by sport', () => {
  const activityWithSport = (
    id: number,
    sport: string,
    durationSeconds: number | null,
    sportResolution = 'resolved',
    sportSubgroup: string | null = null,
  ) =>
    activitySchema.parse({
      ...activity(id, addDays(chartsFirstWeek, 1), durationSeconds),
      sport,
      sportSubgroup,
      sportResolution,
    });

  it('adds up the sport totals of each week to the Calendar total', () => {
    const summary = chartsSummary(mixedSportsWorkspace(), selection);
    for (const week of summary.weeks) {
      const sports = Object.values(week.recordedSecondsBySport);
      expect(sports.reduce((sum, item) => sum + item.knownCount + item.missingCount, 0)).toBe(
        week.recordedSeconds.knownCount + week.recordedSeconds.missingCount,
      );
      if (week.recordedSeconds.missingCount === 0)
        expect(sports.reduce((sum, item) => sum + item.value!, 0)).toBe(week.recordedSeconds.value);
    }
    expect(recordedSports(summary)).toEqual([
      'running',
      'cycling',
      'winter_sports',
      'hiking',
      'swimming',
      'other',
    ]);
  });

  it('counts a subgroup once and sends unknown or unresolved sports to Other', () => {
    const data = emptyWorkspace();
    data.activities = [
      activityWithSport(600, 'running', 1800, 'resolved', 'trail_running'),
      activityWithSport(601, 'running', 600, 'unresolved'),
      activityWithSport(602, 'fitness_equipment', 1200),
    ];
    const [week] = chartsSummary(data, selection).weeks;
    expect(week!.recordedSecondsBySport.running).toEqual({
      value: 1800,
      knownCount: 1,
      missingCount: 0,
    });
    expect(week!.recordedSecondsBySport.other).toEqual({
      value: 1800,
      knownCount: 2,
      missingCount: 0,
    });
  });

  it('shows a zero, a missing and a partial duration per sport, No sessions recorded for a sport not done, and Upcoming for later weeks', () => {
    const data = emptyWorkspace();
    data.activities = [
      activityWithSport(700, 'running', null),
      activityWithSport(701, 'cycling', 0),
      activityWithSport(702, 'hiking', null),
      activityWithSport(703, 'hiking', 1800),
    ];
    const weeks = trainingBySportWeeks(chartsSummary(data, selection), chartsToday, minutes);
    expect(weeks[0]).toMatchObject({
      sessionSports: ['running', 'cycling', 'hiking'],
      hoursBySport: { running: null, cycling: 0, hiking: 0.5, swimming: null },
      labelBySport: {
        running: 'Duration missing',
        cycling: '0m',
        hiking: '30m (1 of 2 sessions without duration)',
        swimming: 'No sessions recorded',
      },
    });
    expect(weeks[13]).toMatchObject({
      sessionSports: [],
      hoursBySport: { running: null, cycling: null },
      labelBySport: { running: 'Upcoming', cycling: 'Upcoming' },
    });
  });

  it('labels an empty week No sessions recorded and a week with a zero-minute run 0m, in total and per sport', () => {
    const data = emptyWorkspace();
    data.activities = [activityWithSport(710, 'running', 0)];
    const [zeroWeek, emptyWeek] = trainingBySportWeeks(
      chartsSummary(data, { ...selection, weeks: 2 }),
      chartsToday,
      minutes,
    );
    expect(zeroWeek).toMatchObject({
      recordedLabel: '0m',
      labelBySport: { running: '0m', cycling: 'No sessions recorded' },
      hoursBySport: { running: 0, cycling: null },
    });
    expect(emptyWeek).toMatchObject({
      recordedLabel: 'No sessions recorded',
      labelBySport: { running: 'No sessions recorded', cycling: 'No sessions recorded' },
      hoursBySport: { running: null, cycling: null },
    });
  });

  it('lists no sport for an empty selection', () => {
    expect(recordedSports(chartsSummary(emptyWorkspace(), selection))).toEqual([]);
  });
});

describe('charts climbing and heart rate', () => {
  const activityWithMeasures = (
    id: number,
    day: number,
    sport: string,
    measures: {
      durationSeconds?: number;
      distanceMeters: number | null;
      elevationMeters: number | null;
      averageHeartRateBpm: number | null;
      sportSubgroup?: string;
    },
  ) =>
    activitySchema.parse({
      ...activity(id, addDays(chartsFirstWeek, day), measures.durationSeconds ?? 3600),
      sport,
      sportSubgroup: measures.sportSubgroup ?? null,
      ...measures,
    });
  const climbingData = () => {
    const data = emptyWorkspace();
    data.activities = [
      activityWithMeasures(900, 1, 'running', {
        sportSubgroup: 'trail_running',
        distanceMeters: 10000,
        elevationMeters: 200,
        averageHeartRateBpm: 150,
      }),
      activityWithMeasures(901, 2, 'running', {
        durationSeconds: 1800,
        distanceMeters: 5000,
        elevationMeters: null,
        averageHeartRateBpm: null,
      }),
      activityWithMeasures(902, 3, 'cycling', {
        distanceMeters: 30000,
        elevationMeters: 500,
        averageHeartRateBpm: 130,
      }),
      activityWithMeasures(903, 8, 'running', {
        distanceMeters: 8000,
        elevationMeters: null,
        averageHeartRateBpm: 148,
      }),
      activityWithMeasures(904, 15, 'hiking', {
        distanceMeters: 6000,
        elevationMeters: 0,
        averageHeartRateBpm: null,
      }),
      activityWithMeasures(905, -1, 'running', {
        distanceMeters: 9000,
        elevationMeters: 90,
        averageHeartRateBpm: 151,
      }),
    ];
    return data;
  };

  it('returns elevation per sport, the running climb inputs and the sessions of the selected weeks', () => {
    const summary = chartsSummary(climbingData(), selection);
    expect(summary.weeks[0]!.recordedElevationMetersBySport.running).toEqual({
      value: 200,
      knownCount: 1,
      missingCount: 1,
    });
    expect(summary.weeks[0]!.recordedElevationMetersBySport.cycling).toEqual({
      value: 500,
      knownCount: 1,
      missingCount: 0,
    });
    expect(summary.weeks[0]!.runningClimb).toEqual({
      sessionCount: 2,
      measuredSessionCount: 1,
      elevationMeters: 200,
      distanceMeters: 10000,
    });
    expect(summary.sessions.map(({ sport, date }) => [sport, date])).toEqual([
      ['running', '2029-10-23'],
      ['running', '2029-10-24'],
      ['cycling', '2029-10-25'],
      ['running', '2029-10-30'],
      ['hiking', '2029-11-06'],
    ]);
  });

  it('labels elevation and running climb in metres or feet', () => {
    const summary = chartsSummary(climbingData(), selection);
    const metric = climbingWeeks(summary, chartsToday, 'metric');
    expect(metric[0]).toMatchObject({
      sessionSports: ['running', 'cycling'],
      elevationLabelBySport: {
        running: '200 m (1 of 2 sessions without elevation)',
        cycling: '500 m',
      },
      runningClimbLabel: '20 m/km (partial)',
    });
    expect(metric[0]!.runningClimb).toBeCloseTo(20, 2);
    expect(metric[1]).toMatchObject({
      elevationBySport: { running: null },
      elevationLabelBySport: { running: 'Elevation missing' },
      runningClimb: null,
      runningClimbLabel: 'Not measured',
    });
    expect(metric[2]).toMatchObject({
      elevationBySport: { hiking: 0, cycling: null },
      elevationLabelBySport: { hiking: '0 m', cycling: 'No sessions recorded' },
      runningClimbLabel: 'No running',
    });
    expect(metric[13]).toMatchObject({
      elevationBySport: { running: null },
      runningClimbLabel: 'Upcoming',
    });
    expect(climbingWeeks(summary, chartsToday, 'imperial')[0]).toMatchObject({
      elevationLabelBySport: { running: '656 ft (1 of 2 sessions without elevation)' },
      runningClimbLabel: '106 ft/mi (partial)',
    });
  });

  it('measures running climb only on runs with both elevation and distance', () => {
    const data = emptyWorkspace();
    data.activities = [
      activityWithMeasures(910, 1, 'running', {
        distanceMeters: null,
        elevationMeters: 200,
        averageHeartRateBpm: null,
      }),
      activityWithMeasures(911, 2, 'running', {
        distanceMeters: 10000,
        elevationMeters: null,
        averageHeartRateBpm: null,
      }),
    ];
    const [unmeasured] = climbingWeeks(chartsSummary(data, selection), chartsToday, 'metric');
    expect(unmeasured).toMatchObject({ runningClimb: null, runningClimbLabel: 'Not measured' });
    data.activities.push(
      activityWithMeasures(912, 3, 'running', {
        distanceMeters: 5000,
        elevationMeters: 60,
        averageHeartRateBpm: null,
      }),
    );
    const [partial] = climbingWeeks(chartsSummary(data, selection), chartsToday, 'metric');
    expect(partial!.runningClimbLabel).toBe('12 m/km (partial)');
  });

  it('lists a manual session on its performed date without heart rate, and a linked workout once', () => {
    const data = climbingData();
    const completedWorkout = (id: number, completion: Record<string, unknown>) =>
      workoutSchema.parse({
        id: chartsId(id),
        revision: 1,
        title: `Synthetic workout ${id}`,
        sport: 'running',
        schedule: { kind: 'independent', date: addDays(chartsFirstWeek, 4) },
        durationSeconds: 3600,
        completion: {
          status: 'completed',
          durationSeconds: 2700,
          distanceMeters: 8000,
          rpe: null,
          reason: '',
          ...completion,
        },
      });
    data.workouts = [
      completedWorkout(920, {
        source: 'manual',
        activityId: null,
        performedDate: addDays(chartsFirstWeek, 5),
      }),
      completedWorkout(921, {
        source: 'garmin',
        activityId: chartsId(900),
        performedDate: addDays(chartsFirstWeek, 1),
      }),
    ];
    const summary = chartsSummary(data, selection);
    const running = heartRateSessions(summary, 'running', minutes);
    expect(running.map(({ id, date, heartRateLabel }) => [id, date, heartRateLabel])).toEqual([
      [chartsId(900), '2029-10-23', '150 bpm'],
      [chartsId(901), '2029-10-24', 'No heart rate'],
      [chartsId(920), '2029-10-27', 'No heart rate'],
      [chartsId(903), '2029-10-30', '148 bpm'],
    ]);
    expect(summary.weeks[0]!.runningClimb).toMatchObject({
      sessionCount: 3,
      measuredSessionCount: 1,
    });
  });

  it('picks the sport with the most heart rate sessions and keeps sessions without heart rate in the table', () => {
    const summary = chartsSummary(climbingData(), selection);
    const sports = sportsWithHeartRate(summary);
    expect(sports).toEqual(['running', 'cycling']);
    expect(sportWithMostHeartRate(summary, sports)).toBe('running');
    expect(
      heartRateSessions(summary, 'running', minutes).map((session) => session.heartRateLabel),
    ).toEqual(['150 bpm', 'No heart rate', '148 bpm']);
    expect(sportsWithHeartRate(chartsSummary(emptyWorkspace(), selection))).toEqual([]);
    const cyclingWeek = climbingData();
    cyclingWeek.activities.push(
      activityWithMeasures(906, 4, 'cycling', {
        distanceMeters: 20000,
        elevationMeters: 300,
        averageHeartRateBpm: 126,
      }),
      activityWithMeasures(907, 5, 'cycling', {
        distanceMeters: 25000,
        elevationMeters: 350,
        averageHeartRateBpm: 128,
      }),
    );
    expect(sportWithMostHeartRate(chartsSummary(cyclingWeek, selection), sports)).toBe('cycling');
  });
});

describe('charts resting heart rate and HRV', () => {
  const hrvRecords = (values: (number | null)[], lastNight: string) =>
    values.map((value, index) =>
      nightRecord(
        1500 + index,
        addDays(lastNight, index - values.length + 1),
        'hrvMilliseconds',
        value,
      ),
    );

  it('returns each night from 60 days before the period, both metrics on one night', () => {
    const data = emptyWorkspace();
    data.health = [
      nightRecord(1400, addDays(chartsFirstWeek, -60), 'hrvMilliseconds', 52),
      nightRecord(1401, addDays(chartsFirstWeek, -61), 'hrvMilliseconds', 50),
      nightRecord(1402, chartsFirstWeek, 'hrvMilliseconds', 55),
      nightRecord(1403, chartsFirstWeek, 'restingHeartRateBpm', 48, true),
      nightRecord(1404, addDays(chartsFirstWeek, 1), 'hrvMilliseconds', null),
      nightRecord(1405, addDays(chartsFirstWeek, 14 * 7), 'hrvMilliseconds', 60),
    ];
    expect(chartsSummary(data, selection).nights).toEqual([
      {
        date: addDays(chartsFirstWeek, -60),
        restingHeartRateBpm: null,
        restingHeartRateMayBeMinimum: false,
        hrvMilliseconds: 52,
      },
      {
        date: chartsFirstWeek,
        restingHeartRateBpm: 48,
        restingHeartRateMayBeMinimum: true,
        hrvMilliseconds: 55,
      },
    ]);
  });

  it('averages the last 7 nights only from 4 measured nights', () => {
    const data = emptyWorkspace();
    data.health = hrvRecords([60, null, null, 65, null, 70, 85], addDays(chartsFirstWeek, 1));
    const [first, second] = nightRows(
      chartsSummary(data, selection),
      'hrvMilliseconds',
      chartsToday,
    );
    expect(first).toMatchObject({ value: 70, average: null, averageLabel: 'Not enough nights' });
    expect(second).toMatchObject({ value: 85, average: 70, averageLabel: '70 ms (4 of 7 nights)' });
  });

  it('keeps a night without a value with its 7-night average and usual range, and later nights as Upcoming', () => {
    const data = emptyWorkspace();
    data.health = hrvRecords(
      [
        ...Array.from({ length: 60 }, (_, index) => (index % 2 ? 60 : 50)),
        60,
        60,
        60,
        60,
        60,
        60,
        null,
      ],
      addDays(chartsFirstWeek, 6),
    );
    const rows = nightRows(chartsSummary(data, selection), 'hrvMilliseconds', chartsToday);
    expect(rows).toHaveLength(98);
    expect(rows[6]).toMatchObject({
      date: addDays(chartsFirstWeek, 6),
      value: null,
      valueLabel: 'No measure',
      average: 60,
      averageLabel: '60 ms (6 of 7 nights)',
      usualRangeLabel: expect.stringMatching(/^\d+ to \d+ ms$/),
    });
    expect(rows.find((row) => row.date === addDays(chartsToday, 1))).toMatchObject({
      average: null,
      usualRange: null,
      valueLabel: 'Upcoming',
      averageLabel: 'Upcoming',
      usualRangeLabel: 'Upcoming',
    });
  });

  it('shows a usual range only from 30 nights in the previous 60', () => {
    const data = emptyWorkspace();
    data.health = hrvRecords(
      Array.from({ length: 30 }, (_, index) => (index % 2 ? 60 : 50)),
      addDays(chartsFirstWeek, -1),
    );
    const rows = nightRows(chartsSummary(data, selection), 'hrvMilliseconds', chartsToday);
    expect(rows[0]).toMatchObject({ usualRange: [51.25, 58.75], usualRangeLabel: '51 to 59 ms' });
    data.health.shift();
    expect(
      nightRows(chartsSummary(data, selection), 'hrvMilliseconds', chartsToday)[0],
    ).toMatchObject({
      usualRange: null,
      usualRangeLabel: 'Not enough nights',
    });
  });

  it('marks a resting heart rate that Garmin took as the daily minimum', () => {
    const data = emptyWorkspace();
    data.health = [
      nightRecord(1600, chartsFirstWeek, 'restingHeartRateBpm', 47, true),
      nightRecord(1601, addDays(chartsFirstWeek, 1), 'restingHeartRateBpm', 49),
    ];
    const rows = nightRows(chartsSummary(data, selection), 'restingHeartRateBpm', chartsToday);
    expect(rows.slice(0, 3).map((row) => row.valueLabel)).toEqual([
      '47 bpm (daily minimum)',
      '49 bpm',
      'No measure',
    ]);
  });
});
