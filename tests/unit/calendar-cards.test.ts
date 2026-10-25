import { describe, expect, it } from 'vitest';
import { calendarFixture, health } from '../fixtures/calendar';
import { injuriesOnDate, sleepNights } from '../../plugins/calendar/projection';

describe('calendar sleep projection', () => {
  it('groups overnight measurements and preserves reported sleep separately from awake time', () => {
    const data = calendarFixture();
    const before = JSON.stringify(data.health);
    const nights = sleepNights(data.health);
    const complete = nights.find(night => night.date === '2030-01-06')!;
    expect(nights).toHaveLength(3);
    expect(complete).toMatchObject({ durationSeconds: 28800, score: 87, hrvMilliseconds: 58, stageTotal: 30600, stagesComplete: true });
    expect(complete.stages.map(stage => stage.seconds)).toEqual([5400, 18000, 5400, 1800]);
    expect(complete.stages.reduce((sum, stage) => sum + stage.percent!, 0)).toBeCloseTo(100);
    expect(JSON.stringify(data.health)).toBe(before);
  });
  it('keeps known zero while missing stages suppress percentages and totals', () => {
    const partial = sleepNights(calendarFixture().health).find(night => night.date === '2030-01-07')!;
    expect(partial.stages.map(stage => stage.seconds)).toEqual([0, null, null, null]);
    expect(partial.stages.map(stage => stage.percent)).toEqual([null, null, null, null]);
    expect(partial.stageTotal).toBeNull();
    expect(partial.hrvMilliseconds).toBeNull();
    expect(partial.stagesComplete).toBe(false);
  });
  it('shows a score-only night but no invented night for HRV-only or all-null records', () => {
    const nights = sleepNights([health(1, '2030-01-06', 'sleepScore', 0), health(2, '2030-01-07', 'hrvMilliseconds', 50), health(3, '2030-01-08', 'sleepDurationSeconds', null)]);
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ score: 0, durationSeconds: null });
  });
  it('never joins different Garmin accounts or unknown provenance', () => {
    const nights = sleepNights([
      health(1, '2030-01-06', 'sleepDurationSeconds', 28800, 'a'), health(2, '2030-01-06', 'hrvMilliseconds', 50, 'a'),
      health(3, '2030-01-06', 'sleepScore', 90, 'b'), health(4, '2030-01-06', 'hrvMilliseconds', 65, 'b'),
      health(5, '2030-01-06', 'sleepDurationSeconds', 20000, null), health(6, '2030-01-06', 'hrvMilliseconds', 99, null),
    ]);
    expect(nights).toHaveLength(3);
    expect(nights.find(night => night.durationSeconds === 28800)).toMatchObject({ score: null, hrvMilliseconds: 50 });
    expect(nights.find(night => night.score === 90)).toMatchObject({ durationSeconds: null, hrvMilliseconds: 65 });
    expect(nights.find(night => night.durationSeconds === 20000)).toMatchObject({ score: null, hrvMilliseconds: 99 });
  });
  it('uses corrected values deterministically, including corrected missingness', () => {
    const records = [health(1, '2030-01-06', 'sleepScore', 90), health(2, '2030-01-06', 'sleepDurationSeconds', 28800), { ...health(3, '2030-01-06', 'sleepScore', null), revision: 2 }];
    expect(sleepNights(records)[0]?.score).toBeNull();
    expect(sleepNights([...records].reverse())).toEqual(sleepNights(records));
  });
  it('preserves all-zero stages without dividing by zero', () => {
    const records = (['sleepDeepSeconds', 'sleepLightSeconds', 'sleepRemSeconds', 'sleepAwakeSeconds'] as const).map((metric, index) => health(index, '2030-01-06', metric, 0));
    const night = sleepNights(records)[0]!;
    expect(night).toMatchObject({ stagesComplete: true, stageTotal: 0 });
    expect(night.stages.every(stage => stage.percent === null)).toBe(true);
  });
});

describe('calendar injury ranges', () => {
  it('includes both boundaries, excludes past ranges, and continues open constraints', () => {
    const injuries = calendarFixture().injuries;
    expect(injuriesOnDate(injuries, '2030-01-04')).toHaveLength(0);
    expect(injuriesOnDate(injuries, '2030-01-05').map(injury => injury.bodyPart)).toEqual(['Left knee']);
    expect(injuriesOnDate(injuries, '2030-01-08').map(injury => injury.bodyPart)).toEqual(['Left knee']);
    expect(injuriesOnDate(injuries, '2030-01-09').map(injury => injury.bodyPart)).toEqual(['Right shoulder']);
    expect(injuriesOnDate(injuries, '2030-05-09').map(injury => injury.bodyPart)).toEqual(['Right shoulder']);
  });
});
