import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '@athlete-panel/contracts';
import { comparisonPercent, weeklySummary } from '../../plugins/training/summary';
import { weeklySleep, weeklyHrv } from '../../plugins/calendar/weekly-sleep';
import { weeklyFixture } from '../fixtures/weekly';
import { health } from '../fixtures/calendar';

describe('expanded weekly training summary', () => {
  it('counts linked/imported/manual/partial volume once, retains skipped prescriptions and includes other sports only in duration', () => {
    const data = weeklyFixture(), before = JSON.stringify(data);
    const summary = weeklySummary(data, '2030-01-07');
    expect(summary.planned.sessions).toBe(4);
    expect(summary.actual.sessions).toBe(4);
    expect(summary.planned.durationSeconds.value).toBe(18000);
    expect(summary.actual.durationSeconds.value).toBe(14400);
    expect(summary.actual.distanceMeters.running.value).toBe(15000);
    expect(summary.actual.distanceMeters.cycling.value).toBe(50000);
    expect(summary.actual.elevationMeters.running).toEqual({ value: 100, knownCount: 1, missingCount: 1 });
    expect(summary.actual.elevationMeters.cycling).toEqual({ value: 500, knownCount: 1, missingCount: 0 });
    expect(comparisonPercent(summary.planned.durationSeconds, summary.actual.durationSeconds)).toBe(80);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('keeps elevation zero, missing, empty and duplicate-linked records distinct', () => {
    const data = weeklyFixture();
    data.activities[0]!.elevationMeters = 0;
    data.activities.push({ ...data.activities[0]! });
    let summary = weeklySummary(data, '2030-01-07');
    expect(summary.actual.elevationMeters.cycling).toEqual({ value: 0, knownCount: 1, missingCount: 0 });
    data.activities = [];
    summary = weeklySummary(data, '2030-01-07');
    expect(summary.actual.elevationMeters.running).toEqual({ value: null, knownCount: 0, missingCount: 1 });
    expect(summary.actual.elevationMeters.cycling).toEqual({ value: 0, knownCount: 0, missingCount: 0 });
  });
  it('does not compare incomplete, empty or zero-planned totals, and keeps above-plan ratios neutral', () => {
    const data = weeklyFixture();
    data.activities[0]!.durationSeconds = null;
    let summary = weeklySummary(data, '2030-01-07');
    expect(summary.actual.durationSeconds).toEqual({ value: 9000, knownCount: 3, missingCount: 1 });
    expect(comparisonPercent(summary.planned.durationSeconds, summary.actual.durationSeconds)).toBeNull();
    data.activities[0]!.durationSeconds = 30000;
    summary = weeklySummary(data, '2030-01-07');
    expect(comparisonPercent(summary.planned.durationSeconds, summary.actual.durationSeconds)).toBeCloseTo(216.6667);
    data.workouts[3]!.durationSeconds = null;
    summary = weeklySummary(data, '2030-01-07');
    expect(comparisonPercent(summary.planned.durationSeconds, summary.actual.durationSeconds)).toBeNull();
    const empty = weeklySummary(emptyWorkspace(), '2030-01-07');
    expect(comparisonPercent(empty.planned.durationSeconds, empty.actual.durationSeconds)).toBeNull();
    expect(comparisonPercent({ value: 100, knownCount: 1, missingCount: 0 }, { value: 0, knownCount: 1, missingCount: 0 })).toBe(0);
    expect(comparisonPercent({ value: 100, knownCount: 1, missingCount: 0 }, empty.actual.durationSeconds)).toBeNull();
  });
  it('uses performed/provider dates for actual elevation even when the prescription belongs to another week', () => {
    const data = weeklyFixture();
    data.plans[0]!.startDate = '2029-12-31';
    data.workouts[1]!.completion!.performedDate = '2030-01-06';
    const previous = weeklySummary(data, '2029-12-31'), current = weeklySummary(data, '2030-01-07');
    expect(previous.planned.sessions).toBe(1);
    expect(previous.actual.sessions).toBe(1);
    expect(previous.actual.elevationMeters.running.missingCount).toBe(1);
    expect(current.actual.elevationMeters.cycling.value).toBe(500);
    expect(current.actual.elevationMeters.running.missingCount).toBe(0);
  });
});

describe('weekly recorded sleep', () => {
  it('averages known nights, separates missing/upcoming nights, and excludes future measurements', () => {
    const data = weeklyFixture();
    data.health.push(health(203, '2030-01-12', 'sleepDurationSeconds', 36000));
    expect(weeklySleep(data.health, '2030-01-07', '2030-01-09')).toEqual({ averageSeconds: 25200, recordedNights: 2, elapsedNights: 3, missingNights: 1, upcomingNights: 4, ambiguousNights: 0 });
    expect(weeklySleep(data.health, '2030-01-14', '2030-01-09')).toEqual({ averageSeconds: null, recordedNights: 0, elapsedNights: 0, missingNights: 0, upcomingNights: 7, ambiguousNights: 0 });
    expect(weeklySleep([], '2029-12-31', '2030-01-09')).toMatchObject({ averageSeconds: null, missingNights: 7, upcomingNights: 0 });
  });
  it('deduplicates corrected nights including null corrections, and retains known zero', () => {
    const records = [health(1, '2030-01-07', 'sleepDurationSeconds', 28800), health(2, '2030-01-08', 'sleepDurationSeconds', 0), { ...health(3, '2030-01-07', 'sleepDurationSeconds', 25200), revision: 2 }];
    expect(weeklySleep(records, '2030-01-07', '2030-01-13')).toMatchObject({ averageSeconds: 12600, recordedNights: 2, missingNights: 5 });
    expect(weeklySleep([...records].reverse(), '2030-01-07', '2030-01-13')).toEqual(weeklySleep(records, '2030-01-07', '2030-01-13'));
    records.push({ ...health(4, '2030-01-07', 'sleepDurationSeconds', null), revision: 3 });
    expect(weeklySleep(records, '2030-01-07', '2030-01-13')).toMatchObject({ averageSeconds: 0, recordedNights: 1, missingNights: 6 });
  });
  it('counts a date once and exposes ambiguous overlapping source accounts without merging them', () => {
    const records = [health(1, '2030-01-07', 'sleepDurationSeconds', 28800, 'a'), health(2, '2030-01-07', 'sleepDurationSeconds', 25200, 'b'), health(3, '2030-01-08', 'sleepDurationSeconds', 21600)];
    expect(weeklySleep(records, '2030-01-07', '2030-01-09')).toMatchObject({ averageSeconds: 21600, recordedNights: 1, missingNights: 2, ambiguousNights: 1 });
  });
  it('respects explicit week boundaries across a year and includes only each provider local date', () => {
    const records = [health(1, '2029-12-30', 'sleepDurationSeconds', 28800), health(2, '2030-01-06', 'sleepDurationSeconds', 21600)];
    expect(weeklySleep(records, '2029-12-30', '2030-01-10').averageSeconds).toBe(28800);
    expect(weeklySleep(records, '2029-12-31', '2030-01-10').averageSeconds).toBe(21600);
    expect(() => weeklySleep(records, '2030-02-30', '2030-01-10')).toThrow();
  });
});

describe('week header status and session previews', () => {
  it('counts planned status by scheduled date independently from the recorded chronology', () => {
    const data = weeklyFixture();
    expect(weeklySummary(data, '2030-01-07').plannedStatus).toEqual({ completed: 1, partial: 1, skipped: 1, pending: 1 });
    data.workouts[1]!.completion!.performedDate = '2030-01-14';
    expect(weeklySummary(data, '2030-01-07').plannedStatus.partial).toBe(1);
    expect(weeklySummary(data, '2030-01-07').recordedSessions).not.toContainEqual(expect.objectContaining({ title: 'Short easy run' }));
    const next = weeklySummary(data, '2030-01-14');
    expect(next.plannedStatus.partial).toBe(0);
    expect(next.recordedSessions.map(session => session.title)).toEqual(['Short easy run']);
    data.plans[0]!.startDate = null;
    expect(weeklySummary(data, '2030-01-07').plannedStatus.completed).toBe(0);
  });
  it('lists linked pairs once, includes generic/manual records, and sorts by provider/performed date then timestamp', () => {
    const data = weeklyFixture();
    data.activities.reverse();
    const summary = weeklySummary(data, '2030-01-07');
    expect(summary.recordedSessions.map(session => [session.kind, session.title])).toEqual([
      ['activity', 'Morning ride'], ['workout', 'Short easy run'], ['activity', 'River path run'], ['activity', 'Mobility session'],
    ]);
    expect(summary.recordedSessions).toHaveLength(summary.actual.sessions);
    expect(summary.recordedSessions.find(session => session.kind === 'workout')!.startedAt).toBeNull();
  });
  it('uses the latest provider identity before date filtering and keeps distinct accounts separate', () => {
    const data = weeklyFixture(), activity = data.activities[0]!;
    data.activities.push({ ...activity, revision: 2, localDate: '2030-01-14', durationSeconds: 7200 });
    expect(weeklySummary(data, '2030-01-07').recordedSessions.some(session => session.id === activity.id)).toBe(false);
    expect(weeklySummary(data, '2030-01-14').actual.durationSeconds.value).toBe(7200);
    data.activities.push({ ...activity, id: '10000000-0000-4000-8000-000000000900', provenance: { source: 'synthetic', sourceAccountId: 'another-account' } });
    expect(weeklySummary(data, '2030-01-07').actual.sessions).toBe(4);
    expect(weeklySummary({ ...data, activities: [...data.activities].reverse() }, '2030-01-07')).toEqual(weeklySummary(data, '2030-01-07'));
  });
});

describe('independent weekly HRV coverage', () => {
  it('includes HRV-only nights without requiring sleep and separates future readings', () => {
    const records = [health(1, '2030-01-09', 'hrvMilliseconds', 54), health(2, '2030-01-12', 'hrvMilliseconds', 100)];
    expect(weeklyHrv(records, '2030-01-07', '2030-01-09')).toEqual({ averageMilliseconds: 54, recordedNights: 1, elapsedNights: 3, missingNights: 2, upcomingNights: 4, ambiguousNights: 0 });
    expect(weeklySleep(records, '2030-01-07', '2030-01-09').recordedNights).toBe(0);
    expect(weeklyHrv(records, '2030-01-14', '2030-01-09')).toMatchObject({ averageMilliseconds: null, elapsedNights: 0, upcomingNights: 7 });
  });
  it('resolves corrections including null, retains zero and reports overlapping accounts', () => {
    const records = [health(1, '2030-01-07', 'hrvMilliseconds', 50), { ...health(2, '2030-01-07', 'hrvMilliseconds', null), revision: 2 }, health(3, '2030-01-08', 'hrvMilliseconds', 0), health(4, '2030-01-09', 'hrvMilliseconds', 60, 'a'), health(5, '2030-01-09', 'hrvMilliseconds', 65, 'b')];
    expect(weeklyHrv(records, '2030-01-07', '2030-01-13')).toMatchObject({ averageMilliseconds: 0, recordedNights: 1, missingNights: 6, ambiguousNights: 1 });
    expect(weeklyHrv([...records].reverse(), '2030-01-07', '2030-01-13')).toEqual(weeklyHrv(records, '2030-01-07', '2030-01-13'));
  });
});
