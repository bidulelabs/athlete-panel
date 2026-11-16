import { expect, it } from 'vitest';
import { emptyWorkspace, type CommandInput } from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { weeksUntilRace } from '../../plugins/race-analysis/preparation-weeks';

const hours = (value: number) => value * 3600;
const buildPhaseAndLongRun: CommandInput[] = [
  {
    action: 'period.create',
    values: {
      name: 'Build',
      role: 'build',
      startDate: '2030-03-11',
      endDate: '2030-03-24',
      weeklyDurationSeconds: {
        firstWeek: { min: hours(6), max: hours(8) },
        lastWeek: { min: hours(8), max: hours(10) },
      },
    },
  },
  {
    action: 'workout.create',
    values: {
      title: 'Long run',
      sport: 'running',
      schedule: { kind: 'independent', date: '2030-03-16' },
      durationSeconds: hours(2),
    },
  },
];
const data = applyCommands(emptyWorkspace(), buildPhaseAndLongRun, { actor: 'owner' }).state;

it('lists each week from the current one to race week with its phase, target and planned volume', () => {
  expect(weeksUntilRace(data, '2030-03-04', '2030-03-24')).toEqual([
    {
      weekStart: '2030-03-04',
      phaseName: null,
      weeklyDurationTarget: null,
      plannedSessions: 0,
      plannedDurationSeconds: 0,
    },
    {
      weekStart: '2030-03-11',
      phaseName: 'Build',
      weeklyDurationTarget: { min: hours(6), max: hours(8) },
      plannedSessions: 1,
      plannedDurationSeconds: hours(2),
    },
    {
      weekStart: '2030-03-18',
      phaseName: 'Build',
      weeklyDurationTarget: { min: hours(8), max: hours(10) },
      plannedSessions: 0,
      plannedDurationSeconds: 0,
    },
  ]);
});

it('includes the week of a race run on its first day and no week for a race before this week', () => {
  expect(weeksUntilRace(data, '2030-03-11', '2030-03-18').map((week) => week.weekStart)).toEqual([
    '2030-03-11',
    '2030-03-18',
  ]);
  expect(weeksUntilRace(data, '2030-03-11', '2030-03-10')).toEqual([]);
});

it('starts each week on the day the current week starts', () => {
  const [weekFromSunday, nextWeek] = weeksUntilRace(data, '2030-03-10', '2030-03-23');
  expect(weekFromSunday).toMatchObject({ weekStart: '2030-03-10', plannedSessions: 1 });
  expect(nextWeek).toMatchObject({ weekStart: '2030-03-17', plannedSessions: 0 });
});
