import { describe, expect, it } from 'vitest';
import {
  eventSchema,
  planSchema,
  workoutSchema,
  type EntityChange,
} from '@athlete-panel/contracts';
import { proposalRows } from '../../plugins/agent-bridge/proposal-diff';
import {
  groupChangesByWeek,
  groupChangesByMonth,
  planTitlesById,
  summarizeProposal,
} from '../../plugins/agent-bridge/proposal-weeks';

const plan = planSchema.parse({
  id: '00000000-0000-4000-8000-000000000010',
  revision: 1,
  title: 'Base block',
  startDate: '2026-11-03',
});
const workout = (id: number, title: string) =>
  workoutSchema.parse({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    revision: 1,
    title,
    sport: 'running',
    schedule: { kind: 'independent', date: '2026-11-01' },
  });
const created = (id: number, title: string, date: string): EntityChange => ({
  entity: 'workout',
  id: workout(id, title).id,
  before: null,
  after: workout(id, title),
  beforeEffectiveDate: null,
  afterEffectiveDate: date,
});
const titlesByWeek = (changes: EntityChange[], weekStartsOn: 0 | 1) =>
  groupChangesByWeek(changes, weekStartsOn).map((week) => ({
    weekStart: week.weekStart,
    titles: week.changes
      .map((change) => (change.after ?? change.before) as { title: string })
      .map((record) => record.title),
  }));

describe('proposal review weeks', () => {
  it('groups event dates and includes them in mixed summaries without derived date fields', () => {
    const event = eventSchema.parse({
      id: plan.id,
      revision: 1,
      title: 'Race target',
      kind: 'race',
      date: '2027-01-03',
    });
    const change: EntityChange = { entity: 'event', id: event.id, before: null, after: event };
    expect(summarizeProposal([change])).toMatchObject({
      from: event.date,
      to: event.date,
      added: 1,
    });
    expect(groupChangesByWeek([change], 1)[0]?.weekStart).toBe('2026-12-28');
    expect(groupChangesByWeek([change], 0)[0]?.weekStart).toBe('2027-01-03');
    expect(groupChangesByMonth([change])[0]?.month).toBe('2027-01');
    expect(summarizeProposal([created(2, 'Preparation', '2026-11-08'), change])).toMatchObject({
      from: '2026-11-08',
      to: event.date,
      added: 2,
    });
    expect(proposalRows(change)).toContainEqual({
      field: 'Type',
      before: 'Not present',
      after: 'Race',
    });
    expect(proposalRows(change)).toContainEqual({
      field: 'Date',
      before: 'Not present',
      after: event.date,
    });
    const moved: EntityChange = {
      ...change,
      before: event,
      after: { ...event, revision: 2, date: '2027-02-01' },
    };
    expect(summarizeProposal([moved])).toMatchObject({ from: event.date, to: '2027-02-01' });
    expect(groupChangesByMonth([moved])[0]?.month).toBe('2027-02');
    expect(groupChangesByMonth([{ ...change, before: event, after: null }])[0]?.month).toBe(
      '2027-01',
    );
  });
  it('splits a Sunday and the next Monday only when weeks start on Monday', () => {
    const changes = [
      created(1, 'Monday run', '2026-11-02'),
      created(2, 'Sunday run', '2026-11-01'),
    ];
    expect(titlesByWeek(changes, 1)).toEqual([
      { weekStart: '2026-10-26', titles: ['Sunday run'] },
      { weekStart: '2026-11-02', titles: ['Monday run'] },
    ]);
    expect(titlesByWeek(changes, 0)).toEqual([
      { weekStart: '2026-11-01', titles: ['Sunday run', 'Monday run'] },
    ]);
  });

  it('puts plan records first, then weeks in date order', () => {
    const planCreated: EntityChange = { entity: 'plan', id: plan.id, before: null, after: plan };
    const changes = [
      created(1, 'Later run', '2026-11-12'),
      planCreated,
      created(3, 'Earlier run', '2026-11-04'),
    ];
    expect(titlesByWeek(changes, 1)).toEqual([
      { weekStart: null, titles: ['Base block'] },
      { weekStart: '2026-11-02', titles: ['Earlier run'] },
      { weekStart: '2026-11-09', titles: ['Later run'] },
    ]);
  });

  it('keeps a deleted workout in the week it leaves', () => {
    const removed = workout(1, 'Removed run');
    expect(
      titlesByWeek(
        [
          {
            entity: 'workout',
            id: removed.id,
            before: removed,
            after: null,
            beforeEffectiveDate: '2026-11-05',
            afterEffectiveDate: null,
          },
        ],
        1,
      ),
    ).toEqual([{ weekStart: '2026-11-02', titles: ['Removed run'] }]);
  });

  it('shows a workout moved to another week only in its new week', () => {
    const moved = workout(1, 'Moved run');
    const change: EntityChange = {
      entity: 'workout',
      id: moved.id,
      before: moved,
      after: { ...moved, revision: 2 },
      beforeEffectiveDate: '2026-11-03',
      afterEffectiveDate: '2026-11-10',
    };
    expect(titlesByWeek([change], 1)).toEqual([{ weekStart: '2026-11-09', titles: ['Moved run'] }]);
  });
});

describe('proposal review plan names', () => {
  it.each([
    { before: null, after: plan, from: '2026-11-03', to: '2026-11-03' },
    { before: plan, after: null, from: '2026-11-03', to: '2026-11-03' },
    {
      before: plan,
      after: { ...plan, startDate: '2026-12-01' },
      from: '2026-11-03',
      to: '2026-12-01',
    },
    {
      before: plan,
      after: { ...plan, startDate: '2026-01-01' },
      from: '2026-01-01',
      to: '2026-11-03',
    },
    { before: null, after: { ...plan, startDate: null }, from: undefined, to: undefined },
  ])(
    'includes plan dates in the overview without changing grouping: $from through $to',
    ({ before, after, from, to }) => {
      const change: EntityChange = { entity: 'plan', id: plan.id, before, after };
      expect(summarizeProposal([change])).toMatchObject({ from, to });
      expect(groupChangesByWeek([change], 1)[0]?.weekStart).toBeNull();
    },
  );
  it('names a plan created by the same proposal instead of showing its id', () => {
    const planWorkout = workoutSchema.parse({
      ...workout(1, 'Plan run'),
      schedule: { kind: 'plan', planId: plan.id, day: 1 },
    });
    const changes: EntityChange[] = [
      { entity: 'plan', id: plan.id, before: null, after: plan },
      { entity: 'workout', id: planWorkout.id, before: null, after: planWorkout },
    ];
    const titles = planTitlesById([{ id: 'existing', title: 'Existing plan' }], changes);
    expect(titles).toEqual({ existing: 'Existing plan', [plan.id]: 'Base block' });
    expect(proposalRows(changes[1]!, 'metric', titles)).toContainEqual({
      field: 'Schedule · Plan',
      before: 'Not present',
      after: 'Base block',
    });
    expect(proposalRows(changes[1]!, 'metric', {})).toContainEqual({
      field: 'Schedule · Plan',
      before: 'Not present',
      after: plan.id,
    });
  });
});

it('groups month-boundary weeks without duplicating moves or deletions and summarizes exact changes', async () => {
  const { groupChangesByMonth, summarizeProposal } =
    await import('../../plugins/agent-bridge/proposal-weeks');
  const added = created(1, 'January', '2027-01-31');
  const moved = {
    ...created(2, 'Moved', '2027-02-01'),
    before: workout(2, 'Moved'),
    beforeEffectiveDate: '2026-12-01',
  };
  const deleted = {
    ...created(3, 'Deleted', '2027-02-02'),
    before: workout(3, 'Deleted'),
    after: null,
    beforeEffectiveDate: '2027-02-02',
    afterEffectiveDate: null,
  };
  const changes = [deleted, added, moved];
  const months = groupChangesByMonth(changes);
  expect(months.map((month) => [month.month, month.changes.length])).toEqual([
    ['2027-01', 1],
    ['2027-02', 2],
  ]);
  expect(new Set(months.flatMap((month) => month.changes.map((change) => change.id))).size).toBe(3);
  expect(summarizeProposal(changes)).toEqual({
    from: '2026-12-01',
    to: '2027-02-02',
    sports: ['running'],
    added: 1,
    changed: 1,
    deleted: 1,
  });
});
