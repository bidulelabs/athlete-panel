import { describe, expect, it } from 'vitest';
import {
  agentCommandSchema,
  commandSchema,
  describeAgentAccess,
  emptyRaceNutrition,
  emptyWorkspace,
  grantScopeSchema,
  planningScopeSchema,
  racePlanSchema,
  type CommandInput,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { proposalRows } from '../../plugins/agent-bridge/proposal-diff';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const raceId = id(1);
const otherRaceId = id(2);
const goalId = id(3);
const racePlanId = id(10);
const courseId = id(20);
const run = (state: WorkspaceState, commands: CommandInput[], actor: 'owner' | 'agent' = 'owner') =>
  applyCommands(state, commands, { actor });
const eventCommand = (eventId: string, kind: string, date: string): CommandInput =>
  ({
    action: 'event.create',
    values: { id: eventId, title: `Synthetic ${kind}`, kind, date },
  }) as CommandInput;
const workspaceWithRaces = () =>
  run(emptyWorkspace(), [
    eventCommand(raceId, 'race', '2027-06-20'),
    eventCommand(otherRaceId, 'race', '2027-08-21'),
    eventCommand(goalId, 'goal', '2027-05-01'),
  ]).state;
const createRacePlan = (values: Record<string, unknown> = {}) =>
  ({
    action: 'racePlan.create',
    values: { id: racePlanId, eventId: raceId, ...values },
  }) as CommandInput;
const updateRacePlan = (values: Record<string, unknown>, expectedRevision = 1) =>
  ({ action: 'racePlan.update', id: racePlanId, expectedRevision, values }) as CommandInput;
const agentWrites = {
  briefing: 'Start easy, keep the long climb steady.',
  pacing: [
    { fromMeters: 0, toMeters: 5000, effort: 'Easy, walk the steep ramps' },
    { fromMeters: 5000, toMeters: 12000, effort: 'Steady' },
  ],
  assumptions: ['Dry trail'],
  openQuestions: ['Poles allowed?'],
  courseId,
};

describe('race plan commands', () => {
  it('creates a plan from the target alone', () => {
    const { state, changes } = run(workspaceWithRaces(), [
      createRacePlan({ target: 'Finish comfortably' }),
    ]);
    expect(state.racePlans).toEqual([
      {
        id: racePlanId,
        revision: 1,
        eventId: raceId,
        target: 'Finish comfortably',
        briefing: '',
        pacing: [],
        assumptions: [],
        openQuestions: [],
        startTime: null,
        finishCutoff: null,
        stations: [],
        nutrition: emptyRaceNutrition,
        writtenFor: { courseId: null, target: 'Finish comfortably' },
      },
    ]);
    expect(changes).toMatchObject([{ entity: 'racePlan', before: null }]);
  });

  it('refuses a second plan for the same race, accepts one for another race', () => {
    const withPlan = run(workspaceWithRaces(), [createRacePlan()]).state;
    expect(() => run(withPlan, [createRacePlan({ id: id(11) })])).toThrow(
      expect.objectContaining({ code: 'RACE_PLAN_EXISTS' }),
    );
    expect(
      run(withPlan, [createRacePlan({ id: id(11), eventId: otherRaceId })]).state.racePlans,
    ).toHaveLength(2);
  });

  it.each([
    ['a missing race', id(99)],
    ['a goal', goalId],
  ])('refuses a plan for %s', (_label, eventId) => {
    expect(() => run(workspaceWithRaces(), [createRacePlan({ eventId })])).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('refuses turning a race with a plan into a goal, accepts it without a plan', () => {
    const toGoal = (state: WorkspaceState) =>
      run(state, [
        { action: 'event.update', id: raceId, expectedRevision: 1, values: { kind: 'goal' } },
      ] as CommandInput[]);
    expect(() => toGoal(run(workspaceWithRaces(), [createRacePlan()]).state)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(toGoal(workspaceWithRaces()).state.events.find((item) => item.id === raceId)?.kind).toBe(
      'goal',
    );
  });

  it('deletes the plan with its race and keeps the plan of another race', () => {
    const withPlans = run(workspaceWithRaces(), [
      createRacePlan(),
      createRacePlan({ id: id(11), eventId: otherRaceId }),
    ]).state;
    const { state, changes } = run(withPlans, [
      { action: 'event.delete', id: raceId, expectedRevision: 1 },
    ]);
    expect(state.racePlans.map((racePlan) => racePlan.eventId)).toEqual([otherRaceId]);
    expect(changes.map((change) => [change.entity, change.id, change.after])).toEqual([
      ['event', raceId, null],
      ['racePlan', racePlanId, null],
    ]);
    const withoutPlan = run(workspaceWithRaces(), [
      { action: 'event.delete', id: goalId, expectedRevision: 1 },
    ]);
    expect(withoutPlan.changes).toHaveLength(1);
  });

  it('keeps the owner target when the agent writes the strategy', () => {
    const owned = run(workspaceWithRaces(), [createRacePlan({ target: 'Under 8 hours' })]).state;
    const [racePlan] = run(owned, [updateRacePlan(agentWrites)], 'agent').state.racePlans;
    expect(racePlan).toMatchObject({
      revision: 2,
      target: 'Under 8 hours',
      briefing: agentWrites.briefing,
      pacing: agentWrites.pacing,
      writtenFor: { courseId, target: 'Under 8 hours' },
    });
  });

  describe('a plan that needs review after the owner changed the target', () => {
    const writtenForOldTarget = { courseId, target: 'Under 8 hours' };
    const needsReview = () => {
      const written = run(
        run(workspaceWithRaces(), [createRacePlan({ target: 'Under 8 hours' })]).state,
        [updateRacePlan(agentWrites)],
        'agent',
      ).state;
      return run(written, [updateRacePlan({ target: 'Under 7 hours' }, 2)]).state;
    };

    it('stays so when the agent only writes race day fields', () => {
      const [racePlan] = run(
        needsReview(),
        [updateRacePlan({ courseId, startTime: '07:00' }, 3)],
        'agent',
      ).state.racePlans;
      expect(racePlan).toMatchObject({ startTime: '07:00', writtenFor: writtenForOldTarget });
    });

    it('is reviewed when the agent writes the strategy', () => {
      const [racePlan] = run(
        needsReview(),
        [updateRacePlan({ courseId, briefing: 'Go out slower.' }, 3)],
        'agent',
      ).state.racePlans;
      expect(racePlan!.writtenFor).toEqual({ courseId, target: 'Under 7 hours' });
    });
  });

  it('lets the agent create a plan with an empty target', () => {
    const [racePlan] = run(
      workspaceWithRaces(),
      [createRacePlan({ ...agentWrites, id: undefined })],
      'agent',
    ).state.racePlans;
    expect(racePlan).toMatchObject({ target: '', writtenFor: { courseId, target: '' } });
  });

  it.each([
    ['target on create', createRacePlan({ ...agentWrites, target: 'Win' })],
    [
      'writtenFor on create',
      createRacePlan({ ...agentWrites, writtenFor: { courseId, target: '' } }),
    ],
    ['target on update', updateRacePlan({ courseId, target: 'Win' })],
    ['another race on update', updateRacePlan({ courseId, eventId: otherRaceId })],
    ['no course on update', updateRacePlan({ briefing: 'Go' })],
    ['no course on create', createRacePlan({ briefing: 'Go' })],
  ])('refuses an agent command with %s', (_label, command) => {
    expect(agentCommandSchema.safeParse(command).success).toBe(false);
    expect(() =>
      run(run(workspaceWithRaces(), [createRacePlan()]).state, [command], 'agent'),
    ).toThrow();
  });

  it('refuses an owner command that moves a plan to another race', () => {
    expect(commandSchema.safeParse(updateRacePlan({ eventId: otherRaceId })).success).toBe(false);
  });

  it('keeps writtenFor at the old target until the course is set again', () => {
    const written = run(run(workspaceWithRaces(), [createRacePlan({ target: 'Finish' })]).state, [
      updateRacePlan(agentWrites),
    ]).state;
    const retargeted = run(written, [updateRacePlan({ target: 'Under 8 hours' }, 2)]).state;
    expect(retargeted.racePlans[0]).toMatchObject({
      target: 'Under 8 hours',
      writtenFor: { courseId, target: 'Finish' },
    });
    const reviewed = run(retargeted, [updateRacePlan({ courseId: null }, 3)]).state;
    expect(reviewed.racePlans[0]!.writtenFor).toEqual({ courseId: null, target: 'Under 8 hours' });
  });

  it('refuses a stale revision', () => {
    const state = run(workspaceWithRaces(), [createRacePlan()]).state;
    expect(() => run(state, [updateRacePlan({ briefing: 'Go' }, 2)])).toThrow(
      expect.objectContaining({ code: 'STALE_REVISION' }),
    );
  });
});

describe('race plan field limits', () => {
  const section = (fromMeters: number, toMeters: number, effort = 'Steady') => ({
    fromMeters,
    toMeters,
    effort,
  });
  const accepts = (values: Record<string, unknown>) =>
    agentCommandSchema.safeParse(createRacePlan({ ...agentWrites, ...values })).success;

  it('accepts sections that touch', () => {
    expect(accepts({ pacing: [section(0, 5000), section(5000, 9000)] })).toBe(true);
  });

  it.each([
    ['a null section', { pacing: [null] }],
    ['an effort blank after trim', { pacing: [section(0, 5000, '   ')] }],
    ['a section that ends before it starts', { pacing: [section(5000, 1000)] }],
    ['an empty section', { pacing: [section(5000, 5000)] }],
    ['overlapping sections', { pacing: [section(0, 5000), section(4000, 9000)] }],
    ['sections out of course order', { pacing: [section(5000, 9000), section(0, 5000)] }],
    ['a negative distance', { pacing: [section(-1, 5000)] }],
    [
      '201 sections',
      { pacing: Array.from({ length: 201 }, (_unused, index) => section(index, index + 1)) },
    ],
    ['a briefing of 4001 characters', { briefing: 'a'.repeat(4001) }],
    ['an assumption of 301 characters', { assumptions: ['a'.repeat(301)] }],
    ['21 open questions', { openQuestions: Array.from({ length: 21 }, () => 'Why?') }],
    ['a blank open question', { openQuestions: [' '] }],
    ['a course id that is not a uuid', { courseId: 'course' }],
  ])('refuses %s', (_label, values) => {
    expect(accepts(values)).toBe(false);
  });

  it('refuses an owner target of 121 characters', () => {
    expect(commandSchema.safeParse(createRacePlan({ target: 'a'.repeat(121) })).success).toBe(
      false,
    );
    expect(commandSchema.safeParse(createRacePlan({ target: 'a'.repeat(120) })).success).toBe(true);
  });
});

const station = (number: number, distanceMeters: number, values: Record<string, unknown> = {}) => ({
  id: id(30 + number),
  name: `Synthetic station ${number}`,
  distanceMeters,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: false,
  ...values,
});
const agentStation = (
  number: number,
  distanceMeters: number,
  values: Record<string, unknown> = {},
) => {
  const { source: _source, verified: _verified, ...rest } = station(number, distanceMeters, values);
  return rest;
};
const dropBagItem = (servings: number) => ({ productId: id(40), servings });
const scheduleRow = (servings: number, everyMinutes: number) => ({
  productId: id(40),
  servings,
  everyMinutes,
});
const nutritionWith = (values: Record<string, unknown>) => ({ ...emptyRaceNutrition, ...values });
const raceDay = {
  startTime: '07:00',
  finishCutoff: { dayOffset: 1, time: '01:30' },
  stations: [
    station(1, 0),
    station(2, 9000, {
      cutoff: { dayOffset: 0, time: '09:15' },
      food: 'bananas',
      dropBag: [{ productId: id(40), servings: 2 }],
      action: 'Refill both bottles',
      source: 'race guide',
      verified: true,
    }),
  ],
  nutrition: {
    targets: {
      carbohydrateGramsPerHour: 60,
      fluidMillilitresPerHour: 500,
      sodiumMilligramsPerHour: null,
    },
    schedule: [{ productId: id(40), servings: 0.5, everyMinutes: 30 }],
    cues: [{ when: 'Long climbs', text: 'Eat on the gentler approach' }],
    daysBefore: 'More rice and pasta from Thursday.',
    breakfast: 'Oats and a banana at 04:00.',
    recovery: 'Recovery drink at the finish.',
  },
};
const agentRaceDay = {
  ...raceDay,
  stations: [agentStation(1, 0), agentStation(2, 9000)],
};

describe('race day fields', () => {
  it('stores the start time, finish cutoff, aid stations and nutrition on create and on update', () => {
    const created = run(workspaceWithRaces(), [createRacePlan(raceDay)]).state;
    expect(created.racePlans[0]).toMatchObject(raceDay);
    const updated = run(run(workspaceWithRaces(), [createRacePlan()]).state, [
      updateRacePlan(raceDay),
    ]).state;
    expect(updated.racePlans[0]).toMatchObject({ revision: 2, ...raceDay });
  });

  it('keeps them when an owner update leaves them out, and clears them when it names them', () => {
    const planned = run(workspaceWithRaces(), [createRacePlan(raceDay)]).state;
    const retargeted = run(planned, [updateRacePlan({ target: 'Under 8 hours' })]).state;
    expect(retargeted.racePlans[0]).toMatchObject({ target: 'Under 8 hours', ...raceDay });
    const cleared = run(retargeted, [
      updateRacePlan(
        { startTime: null, finishCutoff: null, stations: [], nutrition: emptyRaceNutrition },
        2,
      ),
    ]).state;
    expect(cleared.racePlans[0]).toMatchObject({
      startTime: null,
      finishCutoff: null,
      stations: [],
      nutrition: emptyRaceNutrition,
    });
  });

  it('keeps them when the agent updates the strategy', () => {
    const planned = run(workspaceWithRaces(), [createRacePlan(raceDay)]).state;
    const [racePlan] = run(planned, [updateRacePlan(agentWrites)], 'agent').state.racePlans;
    expect(racePlan).toMatchObject({ briefing: agentWrites.briefing, ...raceDay });
  });

  it.each([
    ['create', createRacePlan({ ...agentWrites, id: undefined })],
    ['update', updateRacePlan(agentWrites)],
  ])('accepts the race day fields from the agent on %s', (_label, command) => {
    const values = (command as { values: object }).values;
    const withValues = (extra: object) => ({ ...command, values: { ...values, ...extra } });
    expect(agentCommandSchema.safeParse(withValues({})).success).toBe(true);
    expect(agentCommandSchema.safeParse(withValues(agentRaceDay)).success).toBe(true);
    expect(
      agentCommandSchema.safeParse(
        withValues({ stations: [agentStation(1, 0, { id: undefined })] }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['verified', { verified: true }],
    ['source', { source: 'race guide' }],
  ])('refuses a station from the agent carrying %s', (_label, extra) => {
    const stations = [{ ...agentStation(1, 0), ...extra }];
    expect(agentCommandSchema.safeParse(updateRacePlan({ ...agentWrites, stations })).success).toBe(
      false,
    );
    expect(
      agentCommandSchema.safeParse(createRacePlan({ ...agentWrites, id: undefined, stations }))
        .success,
    ).toBe(false);
  });

  it.each([
    ['a null station', { stations: [null] }],
    ['61 stations', { stations: Array.from({ length: 61 }, (_u, n) => agentStation(n, n * 10)) }],
    [
      'stations that do not get farther',
      { stations: [agentStation(1, 500), agentStation(2, 500)] },
    ],
    [
      'two stations with the same id',
      { stations: [agentStation(1, 0), agentStation(2, 10, { id: id(31) })] },
    ],
    ['a station named with blanks', { stations: [agentStation(1, 0, { name: '   ' })] }],
    ['a start time of 24:00', { startTime: '24:00' }],
    [
      'a negative drop bag amount',
      { stations: [agentStation(1, 0, { dropBag: [dropBagItem(-1)] })] },
    ],
    ['a food row of 0 servings', { nutrition: nutritionWith({ schedule: [scheduleRow(0, 30)] }) }],
    ['a food row every 0 minutes', { nutrition: nutritionWith({ schedule: [scheduleRow(1, 0)] }) }],
    [
      'a negative hourly target',
      {
        nutrition: nutritionWith({
          targets: { ...emptyRaceNutrition.targets, carbohydrateGramsPerHour: -1 },
        }),
      },
    ],
  ])('refuses %s from the agent', (_label, extra) => {
    expect(agentCommandSchema.safeParse(updateRacePlan({ ...agentWrites, ...extra })).success).toBe(
      false,
    );
  });

  describe('stations written by the agent', () => {
    const owned = () => run(workspaceWithRaces(), [createRacePlan(raceDay)]).state;
    const agentUpdate = (stations: object[]) =>
      run(owned(), [updateRacePlan({ courseId, stations })], 'agent').state.racePlans[0]!.stations;
    const second = raceDay.stations[1]!;
    const agentSecond = (values: Record<string, unknown>) =>
      agentStation(2, 9000, {
        cutoff: second.cutoff,
        food: second.food,
        dropBag: second.dropBag,
        action: second.action,
        ...values,
      });

    it('keeps the owner confirmation and source of a station left as read', () => {
      expect(agentUpdate([agentStation(1, 0), agentSecond({ stopSeconds: 900 })])[1]).toMatchObject(
        { stopSeconds: 900, verified: true, source: 'race guide' },
      );
    });

    it.each([
      ['moves it', { distanceMeters: 9500 }],
      ['renames it', { name: 'Synthetic renamed station' }],
    ])('clears the confirmation when the agent %s, and keeps its source', (_label, change) => {
      expect(agentUpdate([agentStation(1, 0), agentSecond(change)])[1]).toMatchObject({
        verified: false,
        source: 'race guide',
      });
    });

    it('starts a new station unconfirmed with no source', () => {
      const stations = agentUpdate([agentStation(1, 0), agentSecond({}), agentStation(3, 20000)]);
      expect(stations[1]).toMatchObject({ verified: true });
      expect(stations[2]).toMatchObject({ verified: false, source: '' });
    });

    it('creates a plan whose stations start unconfirmed', () => {
      const created = run(
        workspaceWithRaces(),
        [createRacePlan({ ...agentWrites, courseId, stations: [agentStation(1, 0)] })],
        'agent',
      ).state.racePlans[0]!;
      expect(created.stations).toEqual([{ ...agentStation(1, 0), source: '', verified: false }]);
    });

    it('leaves the owner free to confirm and to clear a station', () => {
      const cleared = run(owned(), [
        updateRacePlan({
          stations: [station(1, 0, { verified: true }), { ...second, verified: false }],
        }),
      ]).state.racePlans[0]!.stations;
      expect(cleared.map((item) => item.verified)).toEqual([true, false]);
    });
  });

  it('reads a plan stored before race day fields with none of them', () => {
    const [stored] = run(workspaceWithRaces(), [createRacePlan()]).state.racePlans;
    const {
      startTime: _startTime,
      finishCutoff: _finishCutoff,
      stations: _stations,
      nutrition: _nutrition,
      ...old
    } = stored!;
    expect(racePlanSchema.parse(old)).toEqual(stored);
  });

  it('gives each plan stored before nutrition its own empty lists', () => {
    const [stored] = run(workspaceWithRaces(), [createRacePlan()]).state.racePlans;
    const { nutrition: _nutrition, ...old } = stored!;
    const first = racePlanSchema.parse(old);
    const second = racePlanSchema.parse(old);
    expect(first.nutrition.schedule).not.toBe(second.nutrition.schedule);
    expect(first.nutrition.targets).not.toBe(second.nutrition.targets);
  });

  it('names aid stations and their fields in the review rows', () => {
    const planned = run(workspaceWithRaces(), [createRacePlan()]).state;
    const [change] = run(planned, [updateRacePlan({ ...raceDay, nutrition: undefined })]).changes;
    const fields = proposalRows(change!, 'metric').map((row) => `${row.field}: ${row.after}`);
    expect(fields).toEqual(
      expect.arrayContaining([
        'Start time: 07:00',
        'Finish cutoff · Days after race day: 1',
        'Aid stations · Aid station 2 · Distance: 9 km',
        'Aid stations · Aid station 2 · Planned stop: 5 min',
        'Aid stations · Aid station 2 · Confirmed: Yes',
        'Aid stations · Aid station 2 · Drop bag · Item 1 · Servings: 2',
      ]),
    );
    expect(fields.join()).not.toContain('Step');
    expect(fields.join()).not.toMatch(/ Id:|Product id/);
    expect(fields.join()).not.toContain(id(40));
  });
});

describe('race day field limits', () => {
  const both = (values: Record<string, unknown>) => [
    commandSchema.safeParse(createRacePlan(values)).success,
    commandSchema.safeParse(updateRacePlan(values)).success,
  ];
  const stations = (count: number) =>
    Array.from({ length: count }, (_unused, index) =>
      station(index, index * 1000, {
        id: `00000000-0000-4000-8001-${String(index).padStart(12, '0')}`,
      }),
    );
  const dropBagItems = (count: number) =>
    Array.from({ length: count }, (_unused, index) => ({
      productId: id(100 + index),
      servings: 1,
    }));

  it.each([
    [
      'a start at midnight and a cutoff at 23:59',
      { startTime: '00:00', finishCutoff: { dayOffset: 0, time: '23:59' } },
    ],
    ['a cutoff six days after race day', { finishCutoff: { dayOffset: 6, time: '12:00' } }],
    ['a station at the start line', { stations: [station(1, 0)] }],
    ['60 stations', { stations: stations(60) }],
    [
      'a drop bag of 20 items',
      {
        stations: [
          station(1, 1000, {
            dropBag: dropBagItems(20),
          }),
        ],
      },
    ],
    ['a stop of 24 hours', { stations: [station(1, 1000, { stopSeconds: 86400 })] }],
    [
      'a station cutoff six days after race day at 23:59',
      { stations: [station(1, 1000, { cutoff: { dayOffset: 6, time: '23:59' } })] },
    ],
    ['an action of 300 characters', { stations: [station(1, 1000, { action: 'a'.repeat(300) })] }],
    ['a source of 120 characters', { stations: [station(1, 1000, { source: 'a'.repeat(120) })] }],
    [
      'a drop bag item of 100 servings',
      { stations: [station(1, 1000, { dropBag: [{ productId: id(40), servings: 100 }] })] },
    ],
  ])('accepts %s', (_label, values) => {
    expect(both(values)).toEqual([true, true]);
  });

  it.each([
    ['24:00', { startTime: '24:00' }],
    ['7:00', { startTime: '7:00' }],
    ['07:60', { startTime: '07:60' }],
    ['a cutoff seven days after race day', { finishCutoff: { dayOffset: 7, time: '12:00' } }],
    ['a cutoff on a fractional day', { finishCutoff: { dayOffset: 0.5, time: '12:00' } }],
    ['a null station', { stations: [null] }],
    ['a station name blank after trim', { stations: [station(1, 1000, { name: '   ' })] }],
    ['a station name of 81 characters', { stations: [station(1, 1000, { name: 'a'.repeat(81) })] }],
    ['61 stations', { stations: stations(61) }],
    ['two stations at the same distance', { stations: [station(1, 1000), station(2, 1000)] }],
    ['stations out of course order', { stations: [station(1, 2000), station(2, 1000)] }],
    ['two stations with one id', { stations: [station(1, 1000), station(1, 2000)] }],
    ['a negative distance', { stations: [station(1, -1)] }],
    ['a negative stop', { stations: [station(1, 1000, { stopSeconds: -1 })] }],
    ['a fractional stop', { stations: [station(1, 1000, { stopSeconds: 1.5 })] }],
    ['a stop over 24 hours', { stations: [station(1, 1000, { stopSeconds: 86401 })] }],
    [
      'a drop bag item with no serving',
      { stations: [station(1, 1000, { dropBag: [{ productId: id(40), servings: 0 }] })] },
    ],
    [
      'a drop bag of 21 items',
      {
        stations: [
          station(1, 1000, {
            dropBag: dropBagItems(21),
          }),
        ],
      },
    ],
    ['food of 201 characters', { stations: [station(1, 1000, { food: 'a'.repeat(201) })] }],
    ['an action of 301 characters', { stations: [station(1, 1000, { action: 'a'.repeat(301) })] }],
    ['a source of 121 characters', { stations: [station(1, 1000, { source: 'a'.repeat(121) })] }],
    [
      'a station cutoff seven days after race day',
      { stations: [station(1, 1000, { cutoff: { dayOffset: 7, time: '12:00' } })] },
    ],
    [
      'a station cutoff at 24:00',
      { stations: [station(1, 1000, { cutoff: { dayOffset: 0, time: '24:00' } })] },
    ],
    [
      'a drop bag product id that is not a uuid',
      { stations: [station(1, 1000, { dropBag: [{ productId: 'gel', servings: 1 }] })] },
    ],
    [
      'a drop bag item of 101 servings',
      { stations: [station(1, 1000, { dropBag: [{ productId: id(40), servings: 101 }] })] },
    ],
    [
      'one product twice in a drop bag',
      {
        stations: [
          station(1, 1000, {
            dropBag: [
              { productId: id(40), servings: 1 },
              { productId: id(40), servings: 2 },
            ],
          }),
        ],
      },
    ],
    ['an unknown station field', { stations: [station(1, 1000, { bag: true })] }],
  ])('refuses %s on create and on update', (_label, values) => {
    expect(both(values)).toEqual([false, false]);
  });

  it.each([
    [
      'a station name blank after trim',
      [station(1, 1000, { name: ' ' })],
      'Name each aid station.',
    ],
    [
      'two stations with one id',
      [station(1, 1000), station(1, 2000)],
      'Each aid station needs its own id.',
    ],
    [
      'one product twice in a drop bag',
      [
        station(1, 1000, {
          dropBag: [
            { productId: id(40), servings: 1 },
            { productId: id(40), servings: 1 },
          ],
        }),
      ],
      'List each product once in a drop bag.',
    ],
  ])('explains %s in plain words', (_label, stations, message) => {
    const parsed = commandSchema.safeParse(updateRacePlan({ stations }));
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(message);
  });
});

describe('race nutrition field limits', () => {
  const both = (changes: Record<string, unknown>) => {
    const nutrition = { ...raceDay.nutrition, ...changes };
    return [
      commandSchema.safeParse(createRacePlan({ nutrition })).success,
      commandSchema.safeParse(updateRacePlan({ nutrition })).success,
    ];
  };
  const scheduleItem = (values: Record<string, unknown> = {}) => ({
    productId: id(40),
    servings: 1,
    everyMinutes: 30,
    ...values,
  });
  const cue = (values: Record<string, unknown> = {}) => ({
    when: 'From 4h',
    text: 'Salt',
    ...values,
  });

  it.each([
    ['30 schedule rows', { schedule: Array.from({ length: 30 }, () => scheduleItem()) }],
    ['20 cues', { cues: Array.from({ length: 20 }, () => cue()) }],
    [
      'half a serving every minute',
      { schedule: [scheduleItem({ servings: 0.5, everyMinutes: 1 })] },
    ],
    [
      '100 servings once a day',
      { schedule: [scheduleItem({ servings: 100, everyMinutes: 1440 })] },
    ],
    [
      'the highest targets',
      {
        targets: {
          carbohydrateGramsPerHour: 500,
          fluidMillilitresPerHour: 5000,
          sodiumMilligramsPerHour: 10000,
        },
      },
    ],
    ['texts of 4000 characters', { breakfast: 'a'.repeat(4000), recovery: 'a'.repeat(4000) }],
  ])('accepts %s', (_label, changes) => {
    expect(both(changes)).toEqual([true, true]);
  });

  it.each([
    ['a null schedule row', { schedule: [null] }],
    ['31 schedule rows', { schedule: Array.from({ length: 31 }, () => scheduleItem()) }],
    ['no serving', { schedule: [scheduleItem({ servings: 0 })] }],
    ['negative servings', { schedule: [scheduleItem({ servings: -1 })] }],
    ['101 servings', { schedule: [scheduleItem({ servings: 101 })] }],
    ['every 0 minutes', { schedule: [scheduleItem({ everyMinutes: 0 })] }],
    ['every 1441 minutes', { schedule: [scheduleItem({ everyMinutes: 1441 })] }],
    ['every 1.5 minutes', { schedule: [scheduleItem({ everyMinutes: 1.5 })] }],
    ['a product id that is not a uuid', { schedule: [scheduleItem({ productId: 'gel' })] }],
    ['21 cues', { cues: Array.from({ length: 21 }, () => cue()) }],
    ['a cue blank after trim', { cues: [cue({ text: '   ' })] }],
    ['a cue time of 81 characters', { cues: [cue({ when: 'a'.repeat(81) })] }],
    ['a cue of 301 characters', { cues: [cue({ text: 'a'.repeat(301) })] }],
    ['a breakfast of 4001 characters', { breakfast: 'a'.repeat(4001) }],
    [
      'a negative target',
      { targets: { ...raceDay.nutrition.targets, carbohydrateGramsPerHour: -1 } },
    ],
    [
      'a sodium target over 10000 mg',
      { targets: { ...raceDay.nutrition.targets, sodiumMilligramsPerHour: 10001 } },
    ],
    ['targets with a field missing', { targets: { carbohydrateGramsPerHour: 60 } }],
    ['an unknown nutrition field', { caffeine: 'none' }],
  ])('refuses %s on create and on update', (_label, changes) => {
    expect(both(changes)).toEqual([false, false]);
  });

  it('refuses a nutrition patch missing one of its fields', () => {
    const { schedule: _schedule, ...withoutSchedule } = raceDay.nutrition;
    expect(commandSchema.safeParse(updateRacePlan({ nutrition: withoutSchedule })).success).toBe(
      false,
    );
  });
});

describe('race plan scope', () => {
  const scope = { from: '2026-11-01', to: '2027-06-30', includeNotes: false };

  it('keeps a scope without a race unchanged and accepts a race id', () => {
    expect(planningScopeSchema.parse(scope)).toEqual(scope);
    expect(planningScopeSchema.parse({ ...scope, raceId })).toEqual({ ...scope, raceId });
  });

  it('refuses a race id that is not a uuid, and a race id on a legacy scope', () => {
    expect(planningScopeSchema.safeParse({ ...scope, raceId: 'race' }).success).toBe(false);
    expect(grantScopeSchema.safeParse({ ...scope, raceId }).success).toBe(false);
  });

  it('refuses a race id on historical review', () => {
    const history = { ...scope, categories: ['training'], weekStartsOn: 1, raceId };
    expect(grantScopeSchema.safeParse({ version: 2, history, planning: null }).success).toBe(false);
    const { raceId: _raceId, ...withoutRace } = history;
    expect(
      grantScopeSchema.safeParse({ version: 2, history: withoutRace, planning: null }).success,
    ).toBe(true);
  });

  it('says whether race preparation is permitted', () => {
    const access = (planning: Record<string, unknown>) =>
      describeAgentAccess(grantScopeSchema.parse({ version: 2, history: null, planning }));
    expect(access({ ...scope, raceId, includeRehearsals: true })).toContain(
      'Race preparation: course summary and race plan of the selected race, its fueling rehearsals, your nutrition profile (products, carry capacity, preferences) shared, race plan proposals permitted.',
    );
    expect(access({ ...scope, raceId })).toContain(
      'Race preparation: course summary and race plan of the selected race, your nutrition profile (products, carry capacity, preferences) shared, race plan proposals permitted.',
    );
    expect(access(scope)).toContain('Race preparation: not permitted.');
  });
});

describe('race plan review rows', () => {
  it('names sections, assumptions and open questions, with distances in profile units', () => {
    const owned = run(workspaceWithRaces(), [createRacePlan({ target: 'Finish' })]);
    const [change] = run(owned.state, [updateRacePlan(agentWrites)], 'agent').changes;
    const fields = proposalRows(change!, 'metric').map((row) => `${row.field}: ${row.after}`);
    expect(fields).toEqual(
      expect.arrayContaining([
        'Pacing · Section 1 · From: 0 km',
        'Pacing · Section 2 · To: 12 km',
        'Pacing · Section 1 · Effort: Easy, walk the steep ramps',
        'Assumptions · Assumption 1: Dry trail',
        'Open questions · Open question 1: Poles allowed?',
        `Written for · Course: ${courseId}`,
      ]),
    );
    expect(fields.join()).not.toContain('Step');
  });
});
