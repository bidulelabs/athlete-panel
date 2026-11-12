import { describe, expect, it } from 'vitest';
import {
  describeAgentAccess,
  emptyWorkspace,
  periodSchema,
  planSchema,
  workspaceStateSchema,
  type CommandInput,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { boundedContext } from '../../plugins/agent-bridge/proposal-validation';
import { mondayOf } from '../../plugins/training/dates';
import {
  movePhase,
  phaseWeekRows,
  planPhases,
  planPhasesOnMove,
  planSections,
} from '../../plugins/training/plan-phases';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const weeklyHours = (first: number, last: number) => ({
  firstWeek: { min: first * 3600, max: (first + 1) * 3600 },
  lastWeek: { min: last * 3600, max: (last + 1) * 3600 },
});
const createPeriod = (values: Record<string, unknown> = {}): CommandInput =>
  ({
    action: 'period.create',
    values: {
      id: id(1),
      name: 'Base',
      role: 'base',
      startDate: '2026-11-02',
      endDate: '2026-12-27',
      weeklyDurationSeconds: weeklyHours(9, 14),
      ...values,
    },
  }) as CommandInput;
const run = (state: WorkspaceState, commands: CommandInput[], actor: 'owner' | 'agent' = 'owner') =>
  applyCommands(state, commands, { actor }).state;

describe('plan phases', () => {
  it('creates a phase with hours only, or with no focus and no target at all', () => {
    const [withHours] = run(emptyWorkspace(), [createPeriod()]).periods;
    expect(withHours).toMatchObject({
      revision: 1,
      focus: '',
      weeklyDurationSeconds: weeklyHours(9, 14),
      weeklyDistanceMeters: null,
      weeklyElevationGainMeters: null,
    });
    const [bare] = run(emptyWorkspace(), [
      createPeriod({ weeklyDurationSeconds: undefined }),
    ]).periods;
    expect(bare).toMatchObject({ focus: '', weeklyDurationSeconds: null });
  });

  it('keeps a trimmed focus and refuses one longer than 120 characters', () => {
    const [phase] = run(emptyWorkspace(), [
      createPeriod({ focus: '  Threshold on flat ' }),
    ]).periods;
    expect(phase!.focus).toBe('Threshold on flat');
    expect(() => run(emptyWorkspace(), [createPeriod({ focus: 'x'.repeat(121) })])).toThrow();
    expect(run(emptyWorkspace(), [createPeriod({ focus: 'x'.repeat(120) })]).periods).toHaveLength(
      1,
    );
  });

  it('updates and deletes a period by revision', () => {
    const state = run(emptyWorkspace(), [createPeriod()]);
    const updated = run(state, [
      { action: 'period.update', id: id(1), expectedRevision: 1, values: { role: 'build' } },
    ]);
    expect(updated.periods[0]).toMatchObject({ role: 'build', revision: 2 });
    expect(() =>
      run(updated, [{ action: 'period.delete', id: id(1), expectedRevision: 1 }]),
    ).toThrow('This item changed');
    expect(
      run(updated, [{ action: 'period.delete', id: id(1), expectedRevision: 2 }]).periods,
    ).toEqual([]);
  });

  it('refuses overlapping periods and accepts the next day', () => {
    const state = run(emptyWorkspace(), [createPeriod()]);
    expect(() =>
      run(state, [createPeriod({ id: id(2), startDate: '2026-12-27', endDate: '2027-01-10' })]),
    ).toThrow('Phases cannot overlap.');
    expect(
      run(state, [createPeriod({ id: id(2), startDate: '2026-12-28', endDate: '2027-01-10' })])
        .periods,
    ).toHaveLength(2);
  });

  it('refuses an update that makes two periods overlap', () => {
    const state = run(emptyWorkspace(), [
      createPeriod(),
      createPeriod({ id: id(2), startDate: '2027-01-04', endDate: '2027-02-28' }),
    ]);
    expect(() =>
      run(state, [
        {
          action: 'period.update',
          id: id(2),
          expectedRevision: 1,
          values: { startDate: '2026-12-01' },
        },
      ]),
    ).toThrow('Phases cannot overlap.');
  });

  it('refuses an end date before the start date, and accepts a one-day period', () => {
    expect(() => run(emptyWorkspace(), [createPeriod({ endDate: '2026-11-01' })])).toThrow();
    expect(run(emptyWorkspace(), [createPeriod({ endDate: '2026-11-02' })]).periods).toHaveLength(
      1,
    );
  });

  it('refuses a weekly range whose maximum is below its minimum, and accepts equal bounds', () => {
    const range = (min: number, max: number) => ({
      firstWeek: { min, max },
      lastWeek: { min: 3600, max: 3600 },
    });
    expect(() =>
      run(emptyWorkspace(), [createPeriod({ weeklyDistanceMeters: range(50000, 40000) })]),
    ).toThrow('Maximum must be at least minimum.');
    expect(
      run(emptyWorkspace(), [createPeriod({ weeklyDistanceMeters: range(40000, 40000) })]).periods,
    ).toHaveLength(1);
  });
});

describe('phases for agents', () => {
  it('accepts period commands from the training agent', () => {
    const state = run(emptyWorkspace(), [createPeriod()], 'agent');
    expect(state.periods).toHaveLength(1);
    expect(
      run(state, [{ action: 'period.delete', id: id(1), expectedRevision: 1 }], 'agent').periods,
    ).toEqual([]);
  });

  it('describes the phase permission of a planning grant', () => {
    const planning = { from: '2026-11-01', to: '2027-10-31', includeNotes: false };
    const describe = (scope: Record<string, unknown>) =>
      describeAgentAccess({ version: 2, history: null, planning: { ...planning, ...scope } });
    expect(describe({ allowPhaseChanges: true })).toContain(
      'Change plan phases: permitted for phases within the proposal dates.',
    );
    expect(describe({})).toContain('Change plan phases: not permitted.');
  });

  it('loads a workspace saved without periods as an empty list', () => {
    const { periods, ...older } = emptyWorkspace();
    expect(periods).toEqual([]);
    expect(workspaceStateSchema.parse(older).periods).toEqual([]);
  });

  it('agent context lists only periods overlapping the grant dates', () => {
    const state = run(emptyWorkspace(), [
      createPeriod(),
      createPeriod({ id: id(2), startDate: '2027-01-04', endDate: '2027-02-28' }),
    ]);
    const context = boundedContext(state, {
      from: '2026-12-27',
      to: '2027-01-03',
      includeNotes: false,
    });
    expect(context.periods.map((item) => item.id)).toEqual([id(1)]);
  });
});

const phase = (number: number, startDate: string, endDate: string) =>
  periodSchema.parse({
    id: id(number),
    revision: 1,
    name: `Phase ${number}`,
    role: 'base',
    startDate,
    endDate,
  });
const plan = (number: number, startDate: string | null) =>
  planSchema.parse({ id: id(100 + number), revision: 1, title: `Plan ${number}`, startDate });

describe('phases in a plan', () => {
  const phases = [
    phase(1, '2026-10-05', '2026-11-01'),
    phase(2, '2026-11-02', '2026-11-29'),
    phase(3, '2026-11-30', '2026-12-27'),
    phase(4, '2027-01-04', '2027-01-31'),
  ];

  it('shows the phases from the plan start until the next scheduled plan starts', () => {
    const autumn = plan(1, '2026-10-19');
    const winter = plan(2, '2027-01-04');
    const names = (shown: ReturnType<typeof planPhases>) => shown.map((item) => item.name);
    expect(names(planPhases(autumn, [autumn, winter, plan(3, null)], phases))).toEqual([
      'Phase 1',
      'Phase 2',
      'Phase 3',
    ]);
    expect(names(planPhases(winter, [autumn, winter], phases))).toEqual(['Phase 4']);
    expect(names(planPhases(autumn, [autumn], phases))).toHaveLength(4);
  });

  it('shows no phase in an unscheduled plan', () => {
    const draft = plan(3, null);
    expect(planPhases(draft, [draft], phases)).toEqual([]);
  });

  it('puts each listed week inside the phase holding its first day', () => {
    const blocks = (shown: ReturnType<typeof planSections>) =>
      shown.map((section) => [section.phase?.name ?? 'No phase', section.weeks]);
    expect(blocks(planSections(phases.slice(0, 3), plan(1, '2026-10-19'), [1, 2, 7]))).toEqual([
      ['Phase 1', [1, 2]],
      ['Phase 2', []],
      ['Phase 3', [7]],
    ]);
    expect(blocks(planSections([phases[3]!], plan(1, '2026-12-28'), [1, 2, 7]))).toEqual([
      ['No phase', [1]],
      ['Phase 4', [2]],
      ['No phase', [7]],
    ]);
  });

  it('leaves a week outside a phase that starts after its first day', () => {
    const midWeek = phase(5, '2026-10-21', '2026-10-31');
    expect(planSections([midWeek], plan(1, '2026-10-19'), [1, 2])).toEqual([
      { phase: null, weeks: [1] },
      { phase: midWeek, weeks: [2] },
    ]);
  });

  it('lists the phases after the last written week as blocks without weeks', () => {
    expect(
      planSections(phases, plan(1, '2026-10-19'), [1]).map((section) => section.weeks),
    ).toEqual([[1], [], [], []]);
  });
});

describe('weeks of a phase in a plan', () => {
  const build = phase(2, '2026-11-02', '2026-11-29');
  const rows = (start: string, written: number[], plans: ReturnType<typeof plan>[] = []) => {
    const shown = plan(1, start);
    return phaseWeekRows(build, shown, [shown, ...plans], written, mondayOf);
  };

  it('puts the target of each calendar week on the plan week starting the same day', () => {
    expect(rows('2026-11-02', [1, 3])).toEqual([
      { firstDay: '2026-11-02', planWeek: 1, targetWeekStart: '2026-11-02' },
      { firstDay: '2026-11-09', planWeek: 2, targetWeekStart: '2026-11-09' },
      { firstDay: '2026-11-16', planWeek: 3, targetWeekStart: '2026-11-16' },
      { firstDay: '2026-11-23', planWeek: 4, targetWeekStart: '2026-11-23' },
    ]);
  });

  it('keeps calendar weeks apart from the weeks of a plan starting midweek', () => {
    expect(rows('2026-11-04', [1, 2])).toEqual([
      { firstDay: '2026-11-02', planWeek: null, targetWeekStart: '2026-11-02' },
      { firstDay: '2026-11-04', planWeek: 1, targetWeekStart: null },
      { firstDay: '2026-11-09', planWeek: null, targetWeekStart: '2026-11-09' },
      { firstDay: '2026-11-11', planWeek: 2, targetWeekStart: null },
      { firstDay: '2026-11-16', planWeek: null, targetWeekStart: '2026-11-16' },
      { firstDay: '2026-11-23', planWeek: null, targetWeekStart: '2026-11-23' },
    ]);
  });

  it('stops the calendar weeks where the next plan starts', () => {
    expect(rows('2026-11-02', [1], [plan(2, '2026-11-16')]).map((row) => row.firstDay)).toEqual([
      '2026-11-02',
      '2026-11-09',
    ]);
  });
});

describe('phases when a plan moves', () => {
  it('moves only the phases no other plan shows, and names the shared ones', () => {
    const autumn = plan(1, '2026-11-02');
    const winter = plan(2, '2026-11-30');
    const own = phase(1, '2026-11-02', '2026-11-22');
    const shared = phase(2, '2026-11-23', '2026-12-20');
    expect(planPhasesOnMove(autumn, [autumn, winter], [own, shared])).toEqual({
      onlyThisPlan: [own],
      shared: [{ phase: shared, plans: [winter] }],
    });
    expect(planPhasesOnMove(autumn, [autumn], [own, shared])).toEqual({
      onlyThisPlan: [own, shared],
      shared: [],
    });
  });

  it('moves the dates and edited weeks, and drops an edited week the move leaves outside the phase', () => {
    const hours = { weeklyDurationSeconds: { min: 3600, max: 7200 } };
    const edited = periodSchema.parse({
      ...phase(1, '2026-11-02', '2026-11-29'),
      editedWeeks: { '2026-11-02': hours, '2026-11-16': hours },
    });
    expect(movePhase(edited, 7)).toEqual({
      values: {
        startDate: '2026-11-09',
        endDate: '2026-12-06',
        editedWeeks: { '2026-11-09': hours, '2026-11-23': hours },
      },
      droppedEditedWeeks: [],
    });
    expect(movePhase(edited, 2)).toEqual({
      values: {
        startDate: '2026-11-04',
        endDate: '2026-12-01',
        editedWeeks: { '2026-11-16': hours },
      },
      droppedEditedWeeks: ['2026-11-02'],
    });
  });
});
