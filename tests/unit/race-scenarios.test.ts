import { describe, expect, it } from 'vitest';
import {
  commandSchema,
  emptyWorkspace,
  RACE_SCENARIO_LIMIT,
  workspaceStateSchema,
  type CommandInput,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { eventDeleteQuestion } from '../../plugins/training/delete-questions';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const raceId = id(1);
const raceWithoutPlanId = id(2);
const goalId = id(3);
const racePlanId = id(4);
const stationId = id(5);
const otherStationId = id(6);
const scenarioId = (index: number) => id(10 + index);
const run = (state: WorkspaceState, commands: CommandInput[], actor: 'owner' | 'agent' = 'owner') =>
  applyCommands(state, commands, { actor });
const racePlanned = () =>
  run(emptyWorkspace(), [
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    {
      action: 'event.create',
      values: { id: raceWithoutPlanId, title: 'Lake Trail 30', kind: 'race', date: '2027-10-03' },
    },
    {
      action: 'event.create',
      values: { id: goalId, title: 'Sub 4h marathon', kind: 'goal', date: '2027-04-11' },
    },
    { action: 'racePlan.create', values: { id: racePlanId, eventId: raceId } },
  ]).state;
const scenarioValues = {
  name: 'Longer stops',
  effortPercent: 5,
  weatherPercent: 0,
  weatherNote: '',
  stops: [{ stationId, stopSeconds: 600 }],
  basedOn: { courseId: null, stations: [{ id: stationId, distanceMeters: 12000 }] },
};
const createScenario = (index: number, values: Record<string, unknown> = {}) =>
  ({
    action: 'raceScenario.create',
    values: { id: scenarioId(index), eventId: raceId, ...scenarioValues, ...values },
  }) as CommandInput;
const withScenario = () => run(racePlanned(), [createScenario(1)]).state;

describe('race scenario record', () => {
  it('creates, updates and deletes a scenario of a race with a plan', () => {
    const created = withScenario();
    expect(created.raceScenarios).toMatchObject([
      { id: scenarioId(1), eventId: raceId, name: 'Longer stops', revision: 1 },
    ]);
    const updated = run(created, [
      {
        action: 'raceScenario.update',
        id: scenarioId(1),
        expectedRevision: 1,
        values: { name: 'Hot day', weatherPercent: 6 },
      },
    ]).state;
    expect(updated.raceScenarios[0]).toMatchObject({
      name: 'Hot day',
      weatherPercent: 6,
      effortPercent: 5,
      revision: 2,
    });
    const deleted = run(updated, [
      { action: 'raceScenario.delete', id: scenarioId(1), expectedRevision: 2 },
    ]).state;
    expect(deleted.raceScenarios).toEqual([]);
  });

  it('refuses an update and a delete with a stale revision', () => {
    const created = withScenario();
    for (const command of [
      {
        action: 'raceScenario.update',
        id: scenarioId(1),
        expectedRevision: 2,
        values: { name: 'Other' },
      },
      { action: 'raceScenario.delete', id: scenarioId(1), expectedRevision: 2 },
    ] as CommandInput[])
      expect(() => run(created, [command])).toThrow('This item changed. Reload before saving.');
  });

  it('does not let an update move a scenario to another race', () => {
    expect(
      commandSchema.safeParse({
        action: 'raceScenario.update',
        id: scenarioId(1),
        expectedRevision: 1,
        values: { eventId: raceWithoutPlanId },
      }).success,
    ).toBe(false);
  });

  it('changes no revision when an update repeats the stored values', () => {
    const created = withScenario();
    const replayed = run(created, [
      {
        action: 'raceScenario.update',
        id: scenarioId(1),
        expectedRevision: 1,
        values: { name: 'Longer stops', stops: scenarioValues.stops },
      },
    ]);
    expect(replayed.changes).toEqual([]);
    expect(replayed.state.raceScenarios[0]!.revision).toBe(1);
  });

  it('refuses a scenario on a goal, a race without a plan and an unknown race', () => {
    for (const eventId of [goalId, raceWithoutPlanId, id(99)])
      expect(() => run(racePlanned(), [createScenario(1, { eventId })])).toThrow(
        'A race scenario needs a race with a plan.',
      );
  });

  it('accepts four scenarios per race and refuses the fifth', () => {
    const indexes = Array.from({ length: RACE_SCENARIO_LIMIT }, (_, index) => index + 1);
    const full = run(
      racePlanned(),
      indexes.map((index) => createScenario(index)),
    ).state;
    expect(full.raceScenarios).toHaveLength(RACE_SCENARIO_LIMIT);
    expect(() => run(full, [createScenario(RACE_SCENARIO_LIMIT + 1)])).toThrow(
      `A race holds at most ${RACE_SCENARIO_LIMIT} scenarios.`,
    );
  });

  it.each([
    ['a duplicate station', [scenarioValues.stops[0], scenarioValues.stops[0]]],
    ['a null stop', [null]],
    ['a negative stop', [{ stationId, stopSeconds: -1 }]],
    ['a stop over 24 hours', [{ stationId, stopSeconds: 86401 }]],
    [
      'more than 60 stops',
      Array.from({ length: 61 }, (_, index) => ({ stationId: id(100 + index), stopSeconds: 0 })),
    ],
  ])('refuses stops with %s', (_label, stops) => {
    expect(() => run(racePlanned(), [createScenario(1, { stops })])).toThrow();
  });

  it('accepts two different stations and no stop', () => {
    const stops = [
      { stationId, stopSeconds: 0 },
      { stationId: otherStationId, stopSeconds: 86400 },
    ];
    expect(run(racePlanned(), [createScenario(1, { stops })]).state.raceScenarios).toHaveLength(1);
    expect(run(racePlanned(), [createScenario(1, { stops: [] })]).state.raceScenarios).toHaveLength(
      1,
    );
  });

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name over 80 characters', { name: 'n'.repeat(81) }],
    ['an effort over 50', { effortPercent: 50.5 }],
    ['a weather note over 300 characters', { weatherNote: 'w'.repeat(301) }],
    ['a name holding half of an emoji', { name: 'Hot \uD83D' }],
    ['a weather note holding half of an emoji', { weatherNote: 'Hot \uDE00' }],
  ])('refuses %s', (_label, values) => {
    expect(() => run(racePlanned(), [createScenario(1, values)])).toThrow();
  });

  it('refuses basedOn with more than 60 stations', () => {
    const stations = Array.from({ length: 61 }, (_, index) => ({
      id: id(100 + index),
      distanceMeters: index,
    }));
    expect(() =>
      run(racePlanned(), [createScenario(1, { basedOn: { courseId: null, stations } })]),
    ).toThrow();
  });

  it('deletes the scenarios with their race, and the question says so', () => {
    const state = withScenario();
    expect(eventDeleteQuestion(state, raceId)).toBe(
      'Delete this event, its race plan and its race scenarios?',
    );
    const deleted = run(state, [{ action: 'event.delete', id: raceId, expectedRevision: 1 }]);
    expect(deleted.state.raceScenarios).toEqual([]);
    expect(deleted.changes.map((change) => change.entity).sort()).toEqual([
      'event',
      'racePlan',
      'raceScenario',
    ]);
  });

  it('keeps the scenarios of another race when a race is deleted', () => {
    const state = run(withScenario(), [
      { action: 'racePlan.create', values: { eventId: raceWithoutPlanId } },
    ]).state;
    const withOtherScenario = run(state, [createScenario(2, { eventId: raceWithoutPlanId })]).state;
    const deleted = run(withOtherScenario, [
      { action: 'event.delete', id: raceWithoutPlanId, expectedRevision: 1 },
    ]).state;
    expect(deleted.raceScenarios.map((scenario) => scenario.id)).toEqual([scenarioId(1)]);
  });

  it('refuses every scenario command from an agent', () => {
    for (const command of [
      createScenario(2),
      { action: 'raceScenario.delete', id: scenarioId(1), expectedRevision: 1 },
    ] as CommandInput[])
      expect(() => run(withScenario(), [command], 'agent')).toThrow(
        'This command is not available to the training agent.',
      );
  });

  it('refuses a race deletion from an agent', () => {
    expect(() =>
      run(withScenario(), [{ action: 'event.delete', id: raceId, expectedRevision: 1 }], 'agent'),
    ).toThrow('This command is not available to the training agent.');
  });

  it('keeps the estimate, stops, cutoffs, effort and weather a scenario was made from, and reads one stored without them', () => {
    const madeFrom = {
      courseId: null,
      stations: [
        {
          id: stationId,
          distanceMeters: 12000,
          stopSeconds: 300,
          cutoff: { dayOffset: 0, time: '11:00' },
        },
      ],
      courseEstimate: { seconds: 6000, lowSeconds: 4800, highSeconds: 7200 },
      effortPercent: 0,
      weatherPercent: 0,
    };
    const stored = run(racePlanned(), [createScenario(1, { basedOn: madeFrom })]).state;
    expect(stored.raceScenarios[0]!.basedOn).toEqual(madeFrom);
    expect(workspaceStateSchema.parse(withScenario()).raceScenarios[0]!.basedOn).toEqual(
      scenarioValues.basedOn,
    );
  });

  it('reads a workspace stored without scenarios as having none', () => {
    const { raceScenarios: _raceScenarios, ...stored } = withScenario();
    expect(workspaceStateSchema.parse(stored).raceScenarios).toEqual([]);
  });

  it('asks nothing about scenarios on an event without any', () => {
    expect(eventDeleteQuestion(racePlanned(), raceWithoutPlanId)).toBeNull();
  });
});
