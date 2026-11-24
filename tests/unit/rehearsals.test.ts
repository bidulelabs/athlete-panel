import { describe, expect, it } from 'vitest';
import {
  commandSchema,
  emptyWorkspace,
  nutritionProductSchema,
  rehearsalSchema,
  workspaceStateSchema,
  type CommandInput,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { assertBounded } from '../../plugins/agent-bridge/proposal-validation';
import {
  eventDeleteQuestion,
  planDeleteQuestion,
  workoutDeleteQuestion,
} from '../../plugins/training/delete-questions';
import { recordName } from '../../plugins/training/history-summary';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const raceId = id(1);
const otherRaceId = id(2);
const goalId = id(3);
const planId = id(4);
const planSessionId = id(5);
const longRunId = id(6);
const rehearsalId = id(10);
const run = (state: WorkspaceState, commands: CommandInput[], actor: 'owner' | 'agent' = 'owner') =>
  applyCommands(state, commands, { actor });
const complete = (workoutId: string, status: 'completed' | 'partial' | 'skipped' = 'completed') =>
  ({
    action: 'workout.complete',
    id: workoutId,
    expectedRevision: 1,
    values: {
      status,
      performedDate: '2026-10-24',
      reason: status === 'completed' ? '' : 'Shortened',
      ...(status === 'skipped' ? {} : { durationSeconds: 9600 }),
    },
  }) as CommandInput;
const training = () =>
  run(emptyWorkspace(), [
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    {
      action: 'event.create',
      values: { id: otherRaceId, title: 'Lake Trail 30', kind: 'race', date: '2027-10-03' },
    },
    {
      action: 'event.create',
      values: { id: goalId, title: 'Sub 4h marathon', kind: 'goal', date: '2027-04-11' },
    },
    { action: 'plan.create', values: { id: planId, title: 'Build', startDate: '2026-10-19' } },
    {
      action: 'workout.create',
      values: {
        id: planSessionId,
        title: 'Hilly long run',
        sport: 'running',
        schedule: { kind: 'plan', planId, day: 6 },
      },
    },
    {
      action: 'workout.create',
      values: {
        id: longRunId,
        title: 'Long trail',
        sport: 'running',
        schedule: { kind: 'independent', date: '2026-10-24' },
      },
    },
  ]).state;
const completedTraining = () =>
  run(training(), [complete(planSessionId), complete(longRunId)]).state;
const logged = {
  items: [
    {
      productName: 'Citrus gel',
      carbohydrateGrams: 30,
      fluidMillilitres: null,
      plannedServings: 2,
      takenServings: 3,
    },
  ],
  extraFluidMillilitres: 500,
  stomach: 'mild',
  conditions: '14 °C, dry',
  lesson: 'Take something less sweet after 2 hours.',
};
const createRehearsal = (values: Record<string, unknown> = {}) =>
  ({
    action: 'rehearsal.create',
    values: { id: rehearsalId, eventId: raceId, workoutId: longRunId, ...logged, ...values },
  }) as CommandInput;
const withRehearsal = () => run(completedTraining(), [createRehearsal()]).state;
const clearCompletion = (workoutId: string) =>
  ({ action: 'workout.clearCompletion', id: workoutId, expectedRevision: 2 }) as CommandInput;

describe('rehearsal commands', () => {
  it('logs a rehearsal without changing the session or its completion', () => {
    const before = completedTraining();
    const { state, changes } = run(before, [createRehearsal()]);
    expect(state.rehearsals).toEqual([
      { id: rehearsalId, revision: 1, eventId: raceId, workoutId: longRunId, ...logged },
    ]);
    expect(changes).toMatchObject([{ entity: 'rehearsal', id: rehearsalId, before: null }]);
    expect(state.workouts).toEqual(before.workouts);
  });

  it.each([
    [
      'an edit',
      {
        action: 'rehearsal.update',
        id: rehearsalId,
        expectedRevision: 1,
        values: { lesson: 'Same gels next time.' },
      },
    ],
    ['a deletion', { action: 'rehearsal.delete', id: rehearsalId, expectedRevision: 1 }],
  ])('leaves the session and its completion unchanged on %s', (_, command) => {
    const before = withRehearsal();
    const { state, changes } = run(before, [command as CommandInput]);
    expect(state.workouts).toEqual(before.workouts);
    expect(changes.map((change) => change.entity)).toEqual(['rehearsal']);
  });

  it('accepts a partial session and refuses a skipped one', () => {
    const partial = run(training(), [complete(longRunId, 'partial')]).state;
    expect(run(partial, [createRehearsal()]).state.rehearsals).toHaveLength(1);
    const skipped = run(training(), [complete(longRunId, 'skipped')]).state;
    expect(() => run(skipped, [createRehearsal()])).toThrow(
      expect.objectContaining({ code: 'WORKOUT_NOT_COMPLETED' }),
    );
  });

  it('refuses a pending session, a missing session and a goal', () => {
    expect(() => run(training(), [createRehearsal()])).toThrow(
      expect.objectContaining({ code: 'WORKOUT_NOT_COMPLETED' }),
    );
    expect(() => run(completedTraining(), [createRehearsal({ workoutId: id(99) })])).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => run(completedTraining(), [createRehearsal({ eventId: goalId })])).toThrow(
      'A fueling rehearsal needs a race.',
    );
  });

  it('refuses a second rehearsal of the same session for the same race, accepts one for another race', () => {
    expect(() => run(withRehearsal(), [createRehearsal({ id: id(11) })])).toThrow(
      expect.objectContaining({ code: 'REHEARSAL_EXISTS' }),
    );
    expect(
      run(withRehearsal(), [createRehearsal({ id: id(11), eventId: otherRaceId })]).state
        .rehearsals,
    ).toHaveLength(2);
  });

  it('edits the lesson of a session no longer marked completed', () => {
    const cleared = run(withRehearsal(), [clearCompletion(longRunId)]).state;
    const { state } = run(cleared, [
      {
        action: 'rehearsal.update',
        id: rehearsalId,
        expectedRevision: 1,
        values: { lesson: 'Same gels next time.' },
      },
    ]);
    expect(state.rehearsals[0]).toMatchObject({ revision: 2, lesson: 'Same gels next time.' });
  });

  it.each(['eventId', 'workoutId'])('refuses an update that moves a rehearsal (%s)', (field) => {
    expect(
      commandSchema.safeParse({
        action: 'rehearsal.update',
        id: rehearsalId,
        expectedRevision: 1,
        values: { [field]: otherRaceId },
      }).success,
    ).toBe(false);
  });

  it('deletes a rehearsal and refuses a stale revision', () => {
    expect(
      run(withRehearsal(), [{ action: 'rehearsal.delete', id: rehearsalId, expectedRevision: 1 }])
        .state.rehearsals,
    ).toEqual([]);
    expect(() =>
      run(withRehearsal(), [{ action: 'rehearsal.delete', id: rehearsalId, expectedRevision: 2 }]),
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
  });

  it('defaults rehearsals to an empty list for a workspace stored without them', () => {
    const { rehearsals, ...stored } = emptyWorkspace();
    expect(rehearsals).toEqual([]);
    expect(workspaceStateSchema.parse(stored).rehearsals).toEqual([]);
  });
});

describe('rehearsal deletion with its session or race', () => {
  it('deletes the rehearsal with a session whose completion was cleared', () => {
    const { state, changes } = run(withRehearsal(), [
      clearCompletion(longRunId),
      { action: 'workout.delete', id: longRunId, expectedRevision: 2 },
    ]);
    expect(state.rehearsals).toEqual([]);
    expect(changes).toContainEqual(
      expect.objectContaining({ entity: 'rehearsal', id: rehearsalId, after: null }),
    );
  });

  it('deletes the rehearsal with the plan holding its session', () => {
    const planned = run(completedTraining(), [
      createRehearsal({ workoutId: planSessionId }),
      clearCompletion(planSessionId),
    ]).state;
    const { state, changes } = run(planned, [
      { action: 'plan.delete', id: planId, expectedRevision: 1 },
    ]);
    expect(state.rehearsals).toEqual([]);
    expect(changes).toContainEqual(
      expect.objectContaining({ entity: 'rehearsal', id: rehearsalId, after: null }),
    );
  });

  it('deletes the rehearsals of a deleted race and keeps those of another race', () => {
    const twoRaces = run(withRehearsal(), [
      createRehearsal({ id: id(11), eventId: otherRaceId }),
    ]).state;
    const { state } = run(twoRaces, [{ action: 'event.delete', id: raceId, expectedRevision: 1 }]);
    expect(state.rehearsals.map((rehearsal) => rehearsal.eventId)).toEqual([otherRaceId]);
  });
});

describe('rehearsals and the agent', () => {
  it('refuses a rehearsal command from the agent', () => {
    expect(() => run(completedTraining(), [createRehearsal()], 'agent')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('refuses an agent proposal that would delete a rehearsal with its session', () => {
    const before = run(withRehearsal(), [clearCompletion(longRunId)]).state;
    const { state, changes } = run(
      before,
      [{ action: 'workout.delete', id: longRunId, expectedRevision: 3 }],
      'agent',
    );
    expect(() =>
      assertBounded(changes, before, state, {
        from: '2026-10-01',
        to: '2026-12-31',
        includeNotes: false,
      }),
    ).toThrow('This change would delete fueling rehearsals. Only the owner can delete them.');
  });
});

describe('rehearsal field limits', () => {
  const stored = { id: rehearsalId, revision: 1, eventId: raceId, workoutId: longRunId, ...logged };
  const item = logged.items[0]!;
  it.each([
    ['a null item', { items: [null] }],
    ['a product name blank after trim', { items: [{ ...item, productName: '   ' }] }],
    ['negative servings taken', { items: [{ ...item, takenServings: -1 }] }],
    ['more than 100 servings taken', { items: [{ ...item, takenServings: 101 }] }],
    ['a third of a serving taken', { items: [{ ...item, takenServings: 0.333 }] }],
    ['51 products', { items: Array.from({ length: 51 }, () => item) }],
    ['an unknown amount of water', { extraFluidMillilitres: null }],
    ['an untested stomach', { stomach: 'untested' }],
    ['a lesson of 4001 characters', { lesson: 'x'.repeat(4001) }],
  ])('refuses %s', (_, values) => {
    expect(rehearsalSchema.safeParse({ ...stored, ...values }).success).toBe(false);
  });

  it('accepts unknown product values and half servings', () => {
    expect(
      rehearsalSchema.safeParse({
        ...stored,
        items: [{ ...item, carbohydrateGrams: null, plannedServings: null, takenServings: 0.5 }],
      }).success,
    ).toBe(true);
  });

  it('uses the same levels for stomach and product tolerance, plus untested for tolerance', () => {
    const product = nutritionProductSchema.shape.tolerance;
    const stomach = rehearsalSchema.shape.stomach;
    expect(product.options).toEqual([...stomach.options, 'untested']);
  });
});

describe('event deletion question', () => {
  it('names the race plan and the fueling rehearsals the race deletion removes', () => {
    const withPlan = run(withRehearsal(), [
      { action: 'racePlan.create', values: { eventId: raceId } },
      { action: 'racePlan.create', values: { eventId: otherRaceId } },
    ]).state;
    expect(eventDeleteQuestion(withPlan, raceId)).toBe(
      'Delete this event, its race plan and its fueling rehearsals?',
    );
    expect(eventDeleteQuestion(withPlan, otherRaceId)).toBe('Delete this event and its race plan?');
    expect(eventDeleteQuestion(withRehearsal(), raceId)).toBe(
      'Delete this event and its fueling rehearsals?',
    );
    expect(eventDeleteQuestion(withRehearsal(), goalId)).toBeNull();
  });
});

describe('session and plan deletion questions', () => {
  it('names the fueling rehearsals a session deletion removes', () => {
    const state = withRehearsal();
    const longRun = state.workouts.find((workout) => workout.id === longRunId)!;
    const planSession = state.workouts.find((workout) => workout.id === planSessionId)!;
    expect(workoutDeleteQuestion(state, longRun)).toBe(
      'Delete “Long trail” and its fueling rehearsals?',
    );
    expect(workoutDeleteQuestion(state, planSession)).toBe('Delete “Hilly long run”?');
  });

  it('names the fueling rehearsals of the planned sessions a plan deletion removes', () => {
    const state = run(withRehearsal(), [
      createRehearsal({ id: id(11), workoutId: planSessionId }),
    ]).state;
    const plan = state.plans[0]!;
    const planSession = state.workouts.filter((workout) => workout.id === planSessionId);
    expect(planDeleteQuestion(state, plan, planSession)).toBe(
      'Delete “Build”, its planned sessions and their fueling rehearsals?',
    );
    expect(planDeleteQuestion(withRehearsal(), plan, planSession)).toBe(
      'Delete “Build” and its planned sessions?',
    );
  });
});

describe('rehearsal in the change history', () => {
  it('names a deleted rehearsal Fueling rehearsal', () => {
    const { changes } = run(withRehearsal(), [
      { action: 'rehearsal.delete', id: rehearsalId, expectedRevision: 1 },
    ]);
    expect(recordName(changes[0]!)).toBe('Fueling rehearsal');
  });
});
