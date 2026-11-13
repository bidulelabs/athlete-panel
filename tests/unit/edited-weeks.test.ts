import { describe, expect, it } from 'vitest';
import {
  emptyWorkspace,
  type ChartsSummaryInput,
  type CommandInput,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import {
  editedWeeksWith,
  findEditedWeek,
  phaseWeekStarts,
  weekTargets,
} from '../../plugins/training/phase-targets';
import { chartsSummary } from '../../plugins/charts/summary';
import { startOfWeek } from '../../packages/ui/src/calendar-dates';

const hours = (value: number) => value * 3600;
const range = (min: number, max: number) => ({ min: hours(min), max: hours(max) });
const buildId = '30000000-0000-4000-8000-000000000097';
const createBuild = (values: Record<string, unknown> = {}): CommandInput =>
  ({
    action: 'period.create',
    values: {
      id: buildId,
      name: 'Build',
      role: 'build',
      startDate: '2030-03-04',
      endDate: '2030-03-31',
      weeklyDurationSeconds: { firstWeek: range(8, 10), lastWeek: range(11, 13) },
      weeklyElevationGainMeters: {
        firstWeek: { min: 1000, max: 1200 },
        lastWeek: { min: 1600, max: 1800 },
      },
      ...values,
    },
  }) as CommandInput;
const run = (state: WorkspaceState, commands: CommandInput[]) =>
  applyCommands(state, commands, { actor: 'owner' }).state;
const update = (state: WorkspaceState, values: Record<string, unknown>) =>
  run(state, [
    {
      action: 'period.update',
      id: buildId,
      expectedRevision: state.periods[0]!.revision,
      values,
    } as CommandInput,
  ]);
const lighterWeek3 = { '2030-03-18': { weeklyDurationSeconds: range(6, 8) } };
const buildWithLighterWeek3 = () =>
  run(emptyWorkspace(), [createBuild({ editedWeeks: lighterWeek3 })]);
const weekHours = (state: WorkspaceState, weekStart: string) => {
  const target = weekTargets(state.periods, weekStart)!.weeklyDurationSeconds!;
  return [target.min / 3600, target.max / 3600];
};
const buildWeeks = ['2030-03-04', '2030-03-11', '2030-03-18', '2030-03-25'];

describe('edited weeks in a phase', () => {
  it('lowers week 3 of a four-week build and leaves the other weeks calculated', () => {
    const state = buildWithLighterWeek3();
    expect(buildWeeks.map((weekStart) => weekHours(state, weekStart))).toEqual([
      [8, 10],
      [9, 11],
      [6, 8],
      [11, 13],
    ]);
    const charts = chartsSummary(state, {
      template: 'training-hours',
      weekStart: '2030-03-04',
      weeks: 4,
    } as ChartsSummaryInput);
    expect(
      charts.volume!.buckets.map((bucket) => [
        bucket.targetSeconds!.min / 3600,
        bucket.targetSeconds!.max / 3600,
      ]),
    ).toEqual([
      [8, 10],
      [9, 11],
      [6, 8],
      [11, 13],
    ]);
  });

  it('keeps the climbing target calculated when only hours are edited', () => {
    expect(
      weekTargets(buildWithLighterWeek3().periods, '2030-03-18')!.weeklyElevationGainMeters,
    ).toEqual({ min: 1400, max: 1600 });
  });

  it('keeps edited weeks when the first and last week targets change', () => {
    const state = update(buildWithLighterWeek3(), {
      weeklyDurationSeconds: { firstWeek: range(9, 11), lastWeek: range(12, 14) },
    });
    expect(state.periods[0]!.editedWeeks).toEqual(lighterWeek3);
    expect(weekHours(state, '2030-03-11')).toEqual([10, 12]);
    expect(weekHours(state, '2030-03-18')).toEqual([6, 8]);
  });

  it('drops edited weeks left outside when the dates move, and keeps those still inside', () => {
    const twoEditedWeeks = run(emptyWorkspace(), [
      createBuild({
        editedWeeks: { ...lighterWeek3, '2030-03-25': { weeklyDurationSeconds: range(9, 9) } },
      }),
    ]);
    const moved = update(twoEditedWeeks, { endDate: '2030-03-23' });
    expect(moved.periods[0]!.editedWeeks).toEqual(lighterWeek3);
  });

  it('removes an edited week when the owner resets it to calculated', () => {
    const state = update(buildWithLighterWeek3(), { editedWeeks: {} });
    expect(weekHours(state, '2030-03-18')).toEqual([10, 12]);
  });
});

describe('edited weeks after a change of week start', () => {
  const mondayEdits = {
    '2030-03-11': { weeklyDurationSeconds: range(7, 9) },
    ...lighterWeek3,
  };
  const buildWithMondayEdits = () =>
    run(emptyWorkspace(), [createBuild({ editedWeeks: mondayEdits })]);

  it('shows edits made on Monday weeks in the Sunday weeks holding their Monday', () => {
    const state = buildWithMondayEdits();
    expect(weekHours(state, '2030-03-10')).toEqual([7, 9]);
    expect(weekHours(state, '2030-03-17')).toEqual([6, 8]);
    expect(weekHours(state, '2030-03-24')).toEqual([10, 12]);
  });

  it('keeps every edit when a Sunday week is saved unchanged', () => {
    const state = buildWithMondayEdits();
    const [phase] = state.periods;
    const editedWeeks = editedWeeksWith(
      phase!,
      '2030-03-17',
      findEditedWeek(phase!, '2030-03-17')!,
    );
    expect(editedWeeks).toEqual(mondayEdits);
    expect(update(state, { editedWeeks }).periods[0]!.editedWeeks).toEqual(mondayEdits);
  });

  it('keys an edit made on a Sunday week by its Monday, next to the existing edits', () => {
    const state = buildWithMondayEdits();
    const editedWeeks = editedWeeksWith(state.periods[0]!, '2030-03-24', {
      weeklyDurationSeconds: range(12, 12),
    });
    const saved = update(state, { editedWeeks });
    expect(Object.keys(saved.periods[0]!.editedWeeks).sort()).toEqual([
      '2030-03-11',
      '2030-03-18',
      '2030-03-25',
    ]);
    expect(weekHours(saved, '2030-03-25')).toEqual([12, 12]);
    expect(weekHours(saved, '2030-03-17')).toEqual([6, 8]);
  });

  it('resets only the edit of the Sunday week reset', () => {
    const state = buildWithMondayEdits();
    const editedWeeks = editedWeeksWith(state.periods[0]!, '2030-03-17', null);
    expect(editedWeeks).toEqual({ '2030-03-11': mondayEdits['2030-03-11'] });
  });
});

describe('edited week checks', () => {
  const buildEditedOn = (monday: string) =>
    createBuild({ editedWeeks: { [monday]: { weeklyDurationSeconds: range(6, 8) } } });

  it('refuses an edited week outside the phase, and accepts the Sunday week of its last day', () => {
    expect(() => run(emptyWorkspace(), [buildEditedOn('2030-04-08')])).toThrow(
      /inside their phase/,
    );
    expect(() => run(emptyWorkspace(), [buildEditedOn('2030-02-25')])).toThrow(
      /inside their phase/,
    );
    expect(run(emptyWorkspace(), [buildEditedOn('2030-04-01')]).periods).toHaveLength(1);
    expect(run(emptyWorkspace(), [buildEditedOn('2030-03-04')]).periods).toHaveLength(1);
  });

  it('refuses an edited week not keyed by a Monday, and accepts the Monday', () => {
    expect(() => run(emptyWorkspace(), [buildEditedOn('2030-03-17')])).toThrow(
      /Monday of the week/,
    );
    expect(run(emptyWorkspace(), [buildEditedOn('2030-03-18')]).periods).toHaveLength(1);
  });

  it('refuses an edited week with no target, or a maximum below its minimum', () => {
    expect(() =>
      run(emptyWorkspace(), [createBuild({ editedWeeks: { '2030-03-18': {} } })]),
    ).toThrow(/at least one target/);
    expect(() =>
      run(emptyWorkspace(), [
        createBuild({ editedWeeks: { '2030-03-18': { weeklyDurationSeconds: range(8, 6) } } }),
      ]),
    ).toThrow();
  });

  it('lists the weeks starting inside a phase for the athlete week start', () => {
    const [phase] = buildWithLighterWeek3().periods;
    expect(phaseWeekStarts(phase!, (date) => startOfWeek(date, 1))).toEqual(buildWeeks);
    expect(phaseWeekStarts(phase!, (date) => startOfWeek(date, 0))).toEqual([
      '2030-03-10',
      '2030-03-17',
      '2030-03-24',
      '2030-03-31',
    ]);
  });
});
