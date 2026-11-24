import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { emptyRaceNutrition, type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { canonical, digest } from '../../packages/host/src/crypto';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { readWorkspaceResponse } from '../../instance/workspace-response';
import { recentChanges } from '../../plugins/training/history-read';
import { mutate } from '../../plugins/training/service';
import {
  applyProposal,
  contextForToken,
  createGrant,
  proposalDetails,
  reviewProposal,
  submitProposal,
  undoChange,
} from '../../plugins/agent-bridge/service';
import { summarizeProposal } from '../../plugins/agent-bridge/proposal-weeks';
import { settings, upload } from '../../plugins/race-analysis/service';
import { syntheticGpx } from '../fixtures/race-analysis';

const url = isolatedDatabaseUrl();
const range = { from: '2026-11-01', to: '2027-06-30' };
const raceId = randomUUID();
const otherRaceId = randomUUID();
const raceAfterRangeId = randomUUID();
let courseId: string;
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate race_analysis.reference_efforts,race_analysis.courses,race_analysis.assets,host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,host.jobs,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await owner([
    race(raceId, 'Synthetic mountain race', '2027-06-20'),
    race(otherRaceId, 'Synthetic spring race', '2027-04-04'),
    race(raceAfterRangeId, 'Synthetic autumn race', '2027-10-16'),
  ]);
  courseId = await uploadCourse();
});
afterAll(closeDatabase);

const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });
const race = (id: string, title: string, date: string): CommandInput => ({
  action: 'event.create',
  values: { id, title, kind: 'race', date },
});
const gpxFile = (options: Parameters<typeof syntheticGpx>[0] = {}) => ({
  name: 'synthetic-course.gpx',
  bytes: Buffer.from(syntheticGpx(options)),
});
async function uploadCourse(
  expectedRevision = 0,
  options: Parameters<typeof syntheticGpx>[0] = {},
) {
  const uploaded = await upload(gpxFile(options), {
    raceId,
    expectedRevision,
    idempotencyKey: randomUUID(),
    purpose: 'course',
  });
  return uploaded.assetId!;
}
const agentWrites = (writtenForCourseId: string | null = courseId) => ({
  briefing: 'Start easy, keep the long climb steady.',
  pacing: [{ fromMeters: 0, toMeters: 5000, effort: 'Easy' }],
  assumptions: ['Dry trail'],
  openQuestions: ['Poles allowed?'],
  courseId: writtenForCourseId,
});
const createRacePlan = (eventId = raceId) => ({
  action: 'racePlan.create',
  values: { eventId, ...agentWrites(eventId === raceId ? courseId : null) },
});
const grantWithRace = (planning: Record<string, unknown> = { raceId, includeRehearsals: true }) =>
  createGrant({
    label: 'Synthetic race preparation',
    version: 2,
    history: null,
    planning: { ...range, includeNotes: false, ...planning },
  });
async function submit(token: string, commands: unknown[]) {
  const context = await contextForToken(token);
  const result = await submitProposal(token, {
    commands,
    summary: 'Prepare the race',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  });
  return { id: result.id, digest: result.digest };
}
const createOwnerRacePlan = async (eventId: string, target: string) => {
  const id = randomUUID();
  await owner([{ action: 'racePlan.create', values: { id, eventId, target } }]);
  return id;
};

it.each([
  ['no race on the grant', {}, raceId, 'forbidden'],
  ['another race on the grant', { raceId: otherRaceId }, raceId, 'forbidden'],
  [
    'a race after the proposal dates',
    { raceId: raceAfterRangeId },
    raceAfterRangeId,
    'out_of_scope',
  ],
])('refuses a race plan with %s', async (_label, planning, eventId, code) => {
  const { token } = await grantWithRace(planning);
  await expect(submit(token, [createRacePlan(eventId)])).rejects.toMatchObject({ code });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});

it('hides whether another race has a plan from an agent that proposes one for it', async () => {
  await createOwnerRacePlan(otherRaceId, 'Under 3 hours');
  const { token } = await grantWithRace();
  await expect(submit(token, [createRacePlan(otherRaceId)])).rejects.toMatchObject({
    code: 'forbidden',
  });
  await expect(submit(token, [createRacePlan(randomUUID())])).rejects.toMatchObject({
    code: 'forbidden',
  });
});

it('shares only the plan of the granted race, and no plan without a race', async () => {
  const granted = await createOwnerRacePlan(raceId, 'Finish comfortably');
  await createOwnerRacePlan(otherRaceId, 'Under 3 hours');
  const withRace = await contextForToken((await grantWithRace()).token);
  expect(withRace.context.racePlans?.map((racePlan) => racePlan.id)).toEqual([granted]);
  const withoutRace = await contextForToken((await grantWithRace({})).token);
  expect(withoutRace.context).not.toHaveProperty('racePlans');
});

it('keeps a proposal ready on a grant without a race when a race plan changes', async () => {
  const { token } = await grantWithRace({ allowPhaseChanges: true });
  const submitted = await submit(token, [
    {
      action: 'period.create',
      values: {
        name: 'Winter base',
        role: 'base',
        startDate: '2026-11-02',
        endDate: '2027-01-31',
        weeklyDurationSeconds: {
          firstWeek: { min: 28800, max: 32400 },
          lastWeek: { min: 36000, max: 39600 },
        },
      },
    },
  ]);
  await createOwnerRacePlan(raceId, 'Finish comfortably');
  expect(await reviewProposal(submitted)).toMatchObject({
    applicability: 'ready',
    contextChanges: [],
  });
});

it('refuses updating the plan of a race outside the grant', async () => {
  const otherPlan = await createOwnerRacePlan(otherRaceId, 'Under 3 hours');
  const { token } = await grantWithRace();
  await expect(
    submit(token, [
      { action: 'racePlan.update', id: otherPlan, expectedRevision: 1, values: agentWrites() },
    ]),
  ).rejects.toMatchObject({ code: 'out_of_scope' });
});

it('applies and undoes a race plan together with a phase and a workout', async () => {
  const { token } = await grantWithRace({ raceId, allowPhaseChanges: true });
  const submitted = await submit(token, [
    createRacePlan(),
    {
      action: 'period.create',
      values: {
        name: 'Race build',
        role: 'build',
        startDate: '2027-03-01',
        endDate: '2027-06-13',
        weeklyDurationSeconds: {
          firstWeek: { min: 28800, max: 32400 },
          lastWeek: { min: 36000, max: 39600 },
        },
      },
    },
    {
      action: 'workout.create',
      values: {
        title: 'Long climb',
        sport: 'running',
        schedule: { kind: 'independent', date: '2027-05-15' },
      },
    },
  ]);
  expect((await loadWorkspace()).racePlans).toHaveLength(0);
  const details = await proposalDetails({ id: submitted.id });
  expect(summarizeProposal(details.changes)).toMatchObject({
    from: '2027-03-01',
    to: '2027-06-13',
    added: 3,
  });
  const listed = await readWorkspaceResponse(range);
  expect(listed.proposals.find((proposal) => proposal.id === submitted.id)?.dateBounds).toEqual({
    from: '2027-03-01',
    to: '2027-06-13',
  });
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  const saved = await loadWorkspace();
  expect(saved.racePlans).toMatchObject([
    {
      eventId: raceId,
      target: '',
      briefing: agentWrites().briefing,
      writtenFor: { courseId, target: '' },
    },
  ]);
  expect([saved.periods.length, saved.workouts.length]).toEqual([1, 1]);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  const undone = await loadWorkspace();
  expect([undone.racePlans.length, undone.periods.length, undone.workouts.length]).toEqual([
    0, 0, 0,
  ]);
});

it('gives a proposal with only a race plan no date bounds', async () => {
  const { token } = await grantWithRace();
  const submitted = await submit(token, [createRacePlan()]);
  const listed = await readWorkspaceResponse(range);
  expect(listed.proposals.find((proposal) => proposal.id === submitted.id)?.dateBounds).toEqual({
    from: null,
    to: null,
  });
  const details = await proposalDetails({ id: submitted.id });
  expect(summarizeProposal(details.changes)).toMatchObject({ from: undefined, to: undefined });
});

it('asks for a new review when the owner edits the plan while a proposal waits', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites() },
  ]);
  expect(await reviewProposal(submitted)).toMatchObject({ applicability: 'ready' });
  await owner([
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: { target: 'Win' } },
  ]);
  const review = await reviewProposal(submitted);
  expect(review.applicability).toBe('conflict');
  expect(review.contextChanges).toMatchObject([{ entity: 'racePlan', id: racePlanId }]);
});

it('keeps the owner target when the proposal is applied, then refuses undo after an owner edit', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites() },
  ]);
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([
    {
      revision: 2,
      target: 'Finish comfortably',
      writtenFor: { courseId, target: 'Finish comfortably' },
    },
  ]);
  await owner([
    {
      action: 'racePlan.update',
      id: racePlanId,
      expectedRevision: 2,
      values: { briefing: 'Mine' },
    },
  ]);
  await expect(undoChange({ id: applied.id, idempotencyKey: randomUUID() })).rejects.toThrow();
  expect((await loadWorkspace()).racePlans[0]).toMatchObject({ briefing: 'Mine' });
});

it('undoes a race deletion together with its plan and names the plan in history', async () => {
  await createOwnerRacePlan(raceId, 'Finish comfortably');
  const deleted = await owner([{ action: 'event.delete', id: raceId, expectedRevision: 1 }]);
  expect((await loadWorkspace()).racePlans).toHaveLength(0);
  await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([{ eventId: raceId }]);
  const titles = (await recentChanges()).map((entry) => entry.title);
  expect(titles).toContain('Created race plan');
});

it('shares the course summary of the granted race without coordinates or file names', async () => {
  await upload(gpxFile({ seconds: 23000 }), {
    raceId,
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    purpose: 'reference',
    title: 'PRIVATE_EFFORT_TITLE',
    terrain: 3,
    durationSeconds: null,
  });
  await settings({
    raceId,
    expectedRevision: 2,
    idempotencyKey: randomUUID(),
    terrain: 3,
    sectionTerrain: { '0': 5 },
  });
  const { context } = await contextForToken((await grantWithRace()).token);
  expect(context.raceCourse).toMatchObject({
    courseId,
    terrain: 3,
    estimate: null,
    references: [{ terrain: 3, hasGaps: false }],
  });
  expect(context.raceCourse!.sections[0]).toMatchObject({ fromMeters: 0, terrain: 5 });
  expect(context.raceCourse!.sections[1]).toMatchObject({ terrain: 3 });
  expect(context.raceCourse!.estimateReasons.length).toBeGreaterThan(0);
  const shared = JSON.stringify(context.raceCourse);
  for (const hidden of [
    'latitude',
    'longitude',
    'points',
    'filename',
    'synthetic-course',
    'PRIVATE_EFFORT_TITLE',
    'assetId',
  ])
    expect(shared).not.toContain(hidden);
});

it('shares no course for a race without one, and no course key without a race', async () => {
  const withoutCourse = await contextForToken((await grantWithRace({ raceId: otherRaceId })).token);
  expect(withoutCourse.context.raceCourse).toBeNull();
  const withoutRace = await contextForToken((await grantWithRace({})).token);
  expect(withoutRace.context).not.toHaveProperty('raceCourse');
});

it.each([
  ['deleted', { action: 'event.delete', id: raceId, expectedRevision: 1 }],
  [
    'turned into a goal',
    { action: 'event.update', id: raceId, expectedRevision: 1, values: { kind: 'goal' } },
  ],
] as const)('shares no course once the race is %s', async (_label, command) => {
  const { token } = await grantWithRace();
  expect((await contextForToken(token)).context.raceCourse).toMatchObject({ courseId });
  await owner([command as CommandInput]);
  expect((await contextForToken(token)).context.raceCourse).toBeNull();
});

it('refuses a race plan written for a course that is no longer in use', async () => {
  const { token } = await grantWithRace();
  const writtenForOldCourse = createRacePlan();
  courseId = await uploadCourse(1, { km: 30, salt: 'replacement' });
  await expect(submit(token, [writtenForOldCourse])).rejects.toMatchObject({
    code: 'stale_context',
  });
  await expect(
    submit(token, [{ ...writtenForOldCourse, values: { ...agentWrites(null), eventId: raceId } }]),
  ).rejects.toMatchObject({ code: 'stale_context' });
  await submit(token, [createRacePlan()]);
  expect(await connection()`select id from host.proposals`).toHaveLength(1);
});

it('accepts a proposal whose context was read before the course was replaced', async () => {
  const { token } = await grantWithRace();
  const read = await contextForToken(token);
  courseId = await uploadCourse(1, { km: 30, salt: 'replacement' });
  const submitted = await submitProposal(token, {
    commands: [createRacePlan()],
    summary: 'Prepare the race',
    contextDigest: read.contextDigest,
    idempotencyKey: randomUUID(),
  });
  expect(await reviewProposal({ id: submitted.id, digest: submitted.digest })).toMatchObject({
    applicability: 'ready',
  });
});

it('still applies a proposal after its course was replaced, leaving the plan to review', async () => {
  const { token } = await grantWithRace();
  const submitted = await submit(token, [createRacePlan()]);
  const writtenFor = courseId;
  await uploadCourse(1, { km: 30, salt: 'replacement' });
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans[0]!.writtenFor.courseId).toBe(writtenFor);
});

const raceDay = {
  startTime: '07:00',
  finishCutoff: { dayOffset: 0, time: '15:00' },
  stations: [
    {
      id: randomUUID(),
      name: 'Synthetic col',
      distanceMeters: 9000,
      cutoff: { dayOffset: 0, time: '09:15' },
      stopSeconds: 240,
      water: true,
      food: 'bananas',
      dropBag: [{ productId: randomUUID(), servings: 2 }],
      action: 'Refill both bottles',
      source: 'race guide',
      verified: true,
    },
  ],
  nutrition: {
    targets: {
      carbohydrateGramsPerHour: 60,
      fluidMillilitresPerHour: 500,
      sodiumMilligramsPerHour: null,
    },
    schedule: [{ productId: randomUUID(), servings: 1, everyMinutes: 30 }],
    cues: [{ when: 'Long climbs', text: 'Eat on the gentler approach' }],
    daysBefore: '',
    breakfast: 'Oats at 04:00',
    recovery: '',
  },
};

it('keeps the owner race day fields when an agent proposal updates the strategy', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  await owner([
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: raceDay },
  ]);
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 2, values: agentWrites() },
  ]);
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([
    { revision: 3, briefing: agentWrites().briefing, ...raceDay },
  ]);
});

it('reads a plan stored before race day fields with none of them', async () => {
  await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const written = await contextForToken(token);
  await connection()`update training.records set data = data - 'startTime' - 'finishCutoff' - 'stations' - 'nutrition' where kind = 'racePlan'`;
  expect((await loadWorkspace()).racePlans).toMatchObject([
    { startTime: null, finishCutoff: null, stations: [], nutrition: emptyRaceNutrition },
  ]);
  expect((await contextForToken(token)).contextDigest).toBe(written.contextDigest);
});

it('changes the context of a race grant, not of a grant without a race, when race day fields are saved', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const withRace = (await grantWithRace()).token;
  const withoutRace = (await grantWithRace({})).token;
  const [raceRead, otherRead] = await Promise.all([
    contextForToken(withRace),
    contextForToken(withoutRace),
  ]);
  await owner([
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: raceDay },
  ]);
  expect((await contextForToken(withRace)).contextDigest).not.toBe(raceRead.contextDigest);
  expect((await contextForToken(withoutRace)).contextDigest).toBe(otherRead.contextDigest);
  await expect(
    submitProposal(withRace, {
      commands: [
        { action: 'racePlan.update', id: racePlanId, expectedRevision: 2, values: agentWrites() },
      ],
      summary: 'Prepare the race',
      contextDigest: raceRead.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'stale_context' });
});

const gelId = randomUUID();
const drinkId = randomUUID();
const product = (id: string, name: string) => ({
  id,
  name,
  kind: 'gel',
  carbohydrateGrams: 30,
  fluidMillilitres: null,
  sodiumMilligrams: null,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'comfortable',
});
const setNutrition = (
  products = [product(gelId, 'Synthetic citrus gel'), product(drinkId, 'Synthetic drink mix')],
  expectedRevision: number | null = null,
) =>
  owner([
    {
      action: 'profile.set',
      expectedRevision,
      values: {
        displayName: 'Synthetic owner',
        nutrition: { products, carryCapacityMillilitres: 1000, preferences: '' },
      },
    } as CommandInput,
  ]);
const agentStation = (name: string, distanceMeters: number, values: object = {}) => ({
  name,
  distanceMeters,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  ...values,
});
const agentRaceDay = (stations: object[], schedule: object[] = []) => ({
  startTime: '07:00',
  finishCutoff: { dayOffset: 1, time: '01:30' },
  stations,
  nutrition: {
    ...emptyRaceNutrition,
    targets: { ...emptyRaceNutrition.targets, carbohydrateGramsPerHour: 60 },
    schedule,
  },
});
const logRehearsal = async (eventId: string) => {
  const workoutId = randomUUID();
  await owner([
    {
      action: 'workout.create',
      values: {
        id: workoutId,
        title: 'Synthetic long run',
        sport: 'running',
        schedule: { kind: 'independent', date: '2026-10-20' },
      },
    },
  ]);
  await owner([
    {
      action: 'workout.complete',
      id: workoutId,
      expectedRevision: 1,
      values: { status: 'completed', performedDate: '2026-10-20', durationSeconds: 9600 },
    },
    {
      action: 'rehearsal.create',
      values: {
        eventId,
        workoutId,
        items: [],
        extraFluidMillilitres: 500,
        stomach: 'comfortable',
        conditions: 'Synthetic conditions',
        lesson: 'Synthetic lesson',
      },
    },
  ]);
};

it('applies and undoes aid stations, targets and a food schedule from the agent', async () => {
  await setNutrition();
  const { token } = await grantWithRace();
  const dropBag = [{ productId: gelId, servings: 2 }];
  const submitted = await submit(token, [
    {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        ...agentWrites(),
        ...agentRaceDay(
          [agentStation('Synthetic start', 0), agentStation('Synthetic hut', 9000, { dropBag })],
          [{ productId: gelId, servings: 1, everyMinutes: 30 }],
        ),
      },
    },
  ]);
  expect((await reviewProposal(submitted)).applicability).toBe('ready');
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  const [racePlan] = (await loadWorkspace()).racePlans;
  expect(racePlan).toMatchObject({
    startTime: '07:00',
    finishCutoff: { dayOffset: 1, time: '01:30' },
    stations: [
      { name: 'Synthetic start', verified: false, source: '' },
      { name: 'Synthetic hut', verified: false, source: '', dropBag },
    ],
    nutrition: { schedule: [{ productId: gelId, servings: 1, everyMinutes: 30 }] },
  });
  expect(racePlan!.stations.every((station) => /^[0-9a-f-]{36}$/.test(station.id))).toBe(true);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toHaveLength(0);
});

it('keeps the owner confirmation unless the agent renames or moves the station', async () => {
  await setNutrition();
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const stationId = randomUUID();
  await owner([
    {
      action: 'racePlan.update',
      id: racePlanId,
      expectedRevision: 1,
      values: {
        stations: [
          {
            ...agentStation('Synthetic hut', 9000),
            id: stationId,
            source: 'race guide',
            verified: true,
          },
        ],
      },
    },
  ]);
  const { token } = await grantWithRace();
  let revision = 2;
  const agentUpdatesStation = async (values: object) => {
    const submitted = await submit(token, [
      {
        action: 'racePlan.update',
        id: racePlanId,
        expectedRevision: revision++,
        values: {
          courseId,
          stations: [{ ...agentStation('Synthetic hut', 9000), id: stationId, ...values }],
        },
      },
    ]);
    await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
    return (await loadWorkspace()).racePlans[0]!.stations[0];
  };
  expect(await agentUpdatesStation({ stopSeconds: 600 })).toMatchObject({
    stopSeconds: 600,
    verified: true,
    source: 'race guide',
  });
  expect(await agentUpdatesStation({ distanceMeters: 9500 })).toMatchObject({
    verified: false,
    source: 'race guide',
  });
});

it('refuses a drop bag or a food schedule naming a product outside the profile', async () => {
  await setNutrition();
  const { token } = await grantWithRace();
  const unknownProductId = randomUUID();
  const create = (stations: object[], schedule: object[]) => [
    {
      action: 'racePlan.create',
      values: { eventId: raceId, ...agentWrites(), ...agentRaceDay(stations, schedule) },
    },
  ];
  await expect(
    submit(
      token,
      create(
        [
          agentStation('Synthetic hut', 9000, {
            dropBag: [{ productId: unknownProductId, servings: 1 }],
          }),
        ],
        [],
      ),
    ),
  ).rejects.toMatchObject({ code: 'unknown_product' });
  await expect(
    submit(token, create([], [{ productId: unknownProductId, servings: 1, everyMinutes: 30 }])),
  ).rejects.toMatchObject({ code: 'unknown_product' });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});

it('refuses a station confirmed by the agent and a rehearsal written by the agent', async () => {
  const { token } = await grantWithRace();
  const confirmed = [{ ...agentStation('Synthetic hut', 9000), id: randomUUID(), verified: true }];
  await expect(
    submit(token, [
      {
        action: 'racePlan.create',
        values: { eventId: raceId, ...agentWrites(), stations: confirmed },
      },
    ]),
  ).rejects.toMatchObject({ issues: [{ code: 'unrecognized_keys', keys: ['verified'] }] });
  await expect(
    submit(token, [
      {
        action: 'rehearsal.create',
        values: { eventId: raceId, workoutId: randomUUID(), items: [] },
      },
    ]),
  ).rejects.toMatchObject({ issues: [{ code: 'invalid_union' }] });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});

it('refuses a source written by the agent when it updates a station', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const station = {
    ...agentStation('Synthetic hut', 9000),
    id: randomUUID(),
    source: 'race guide',
  };
  await expect(
    submit(token, [
      {
        action: 'racePlan.update',
        id: racePlanId,
        expectedRevision: 1,
        values: { courseId, stations: [station] },
      },
    ]),
  ).rejects.toMatchObject({ issues: [{ code: 'unrecognized_keys', keys: ['source'] }] });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});

const updateSchedule = (racePlanId: string, schedule: object[], expectedRevision: number) => [
  {
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision,
    values: { courseId, nutrition: { ...emptyRaceNutrition, schedule } },
  },
];
const everyHalfHour = (productId: string) => ({ productId, servings: 1, everyMinutes: 30 });

it('checks the products of a plan update against the profile', async () => {
  await setNutrition();
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  await expect(
    submit(token, updateSchedule(racePlanId, [everyHalfHour(randomUUID())], 1)),
  ).rejects.toMatchObject({ code: 'unknown_product' });
  await expect(
    submit(token, updateSchedule(racePlanId, [everyHalfHour(drinkId)], 1)),
  ).resolves.toBeDefined();
});

it('accepts a product already in the plan that the profile no longer has', async () => {
  await setNutrition();
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  await owner(updateSchedule(racePlanId, [everyHalfHour(gelId)], 1) as CommandInput[]);
  await setNutrition([product(drinkId, 'Synthetic drink mix')], 1);
  const { token } = await grantWithRace();
  await expect(
    submit(token, updateSchedule(racePlanId, [everyHalfHour(gelId), everyHalfHour(drinkId)], 2)),
  ).resolves.toBeDefined();
  await expect(
    submit(token, updateSchedule(racePlanId, [everyHalfHour(randomUUID())], 2)),
  ).rejects.toMatchObject({ code: 'unknown_product' });
});

it('shares the rehearsals of the granted race only, and none without a race', async () => {
  await logRehearsal(raceId);
  await logRehearsal(otherRaceId);
  const withRace = await contextForToken((await grantWithRace()).token);
  expect(withRace.context.rehearsals?.map((rehearsal) => rehearsal.eventId)).toEqual([raceId]);
  expect(withRace.context.rehearsals?.[0]).toMatchObject({ lesson: 'Synthetic lesson' });
  expect(
    (await contextForToken((await grantWithRace({ includeRehearsals: true })).token)).context,
  ).not.toHaveProperty('rehearsals');
});

it('shares no rehearsals with a race grant approved before rehearsals were shared', async () => {
  await logRehearsal(raceId);
  const { token } = await grantWithRace({ raceId });
  const before = await contextForToken(token);
  expect(before.context).not.toHaveProperty('rehearsals');
  await logRehearsal(raceId);
  const after = await contextForToken(token);
  expect(after.context).not.toHaveProperty('rehearsals');
  expect(after.contextDigest).toBe(before.contextDigest);
});

it('keeps the digest of a grant without a race when a rehearsal is logged', async () => {
  const { token } = await grantWithRace({});
  const before = await contextForToken(token);
  await logRehearsal(raceId);
  const after = await contextForToken(token);
  expect(after.context).not.toHaveProperty('rehearsals');
  expect(after.contextDigest).toBe(before.contextDigest);
});

it('asks a race grant to read again once a rehearsal is logged', async () => {
  const { token } = await grantWithRace();
  const before = await contextForToken(token);
  const stored = await submit(token, [createRacePlan()]);
  await logRehearsal(raceId);
  await expect(
    submitProposal(token, {
      commands: [createRacePlan()],
      summary: 'Prepare the race',
      contextDigest: before.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'stale_context' });
  const review = await reviewProposal(stored);
  expect(review.applicability).toBe('review-required');
  expect(review.contextChanges.map((change) => change.entity)).toContain('rehearsal');
});

const withoutAssumption = <Plan extends object>(plan: Plan) => {
  const {
    effortPercent: _effortPercent,
    weatherPercent: _weatherPercent,
    weatherNote: _weatherNote,
    ...old
  } = plan as Plan & Record<string, unknown>;
  return old;
};
const assumption = { effortPercent: 8, weatherPercent: 6.5, weatherNote: 'Hot afternoon' };
const setAssumption = (racePlanId: string, expectedRevision: number) =>
  owner([{ action: 'racePlan.update', id: racePlanId, expectedRevision, values: assumption }]);
const storeRecordsAsBeforeAssumption = () =>
  connection()`update training.records set data = data - 'effortPercent' - 'weatherPercent' - 'weatherNote' where kind = 'racePlan'`;
async function storeProposalAsBeforeAssumption(proposal: { id: string }) {
  const [row] =
    await connection()`select commands,changes,context,summary from host.proposals where id = ${proposal.id}`;
  const changes = (
    row!.changes as { entity: string; before: object | null; after: object | null }[]
  ).map((change) =>
    change.entity === 'racePlan'
      ? {
          ...change,
          before: change.before && withoutAssumption(change.before),
          after: change.after && withoutAssumption(change.after),
        }
      : change,
  );
  const proposalDigest = digest(
    canonical({
      commands: row!.commands,
      changes,
      contextDigest: (row!.context as { digest: string }).digest,
      summary: row!.summary,
    }),
  );
  await connection()`update host.proposals set changes = ${connection().json(changes as never)}, digest = ${proposalDigest} where id = ${proposal.id}`;
  return { id: proposal.id, digest: proposalDigest };
}

it('keeps the digest of a race grant when a plan stored before the assumption is read', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const written = await contextForToken(token);
  await storeRecordsAsBeforeAssumption();
  expect((await contextForToken(token)).contextDigest).toBe(written.contextDigest);
  expect((await loadWorkspace()).racePlans).toMatchObject([
    { id: racePlanId, effortPercent: 0, weatherPercent: 0, weatherNote: '' },
  ]);
});

it('hides the assumption from the context of a race grant and keeps the digest of a grant without a race', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const withRace = (await grantWithRace()).token;
  const withoutRace = (await grantWithRace({})).token;
  const [raceRead, otherRead] = await Promise.all([
    contextForToken(withRace),
    contextForToken(withoutRace),
  ]);
  await setAssumption(racePlanId, 1);
  const raceAfter = await contextForToken(withRace);
  expect((await contextForToken(withoutRace)).contextDigest).toBe(otherRead.contextDigest);
  const { revision: _before, ...planBefore } = raceRead.context.racePlans![0]!;
  const { revision: _after, ...planAfter } = raceAfter.context.racePlans![0]!;
  expect(planAfter).toEqual(planBefore);
  expect(planAfter).not.toHaveProperty('effortPercent');
  expect(planAfter).not.toHaveProperty('weatherPercent');
  expect(planAfter).not.toHaveProperty('weatherNote');
});

it('keeps the owner assumption when an agent proposal updates the strategy', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  await setAssumption(racePlanId, 1);
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 2, values: agentWrites() },
  ]);
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([
    { revision: 3, briefing: agentWrites().briefing, ...assumption },
  ]);
});

it('reviews, applies and undoes a proposal stored before the assumption existed', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites() },
  ]);
  await storeRecordsAsBeforeAssumption();
  const stored = await storeProposalAsBeforeAssumption(submitted);
  expect((await loadWorkspace()).racePlans).toMatchObject([
    { effortPercent: 0, weatherPercent: 0, weatherNote: '' },
  ]);
  expect(await reviewProposal(stored)).toMatchObject({
    applicability: 'ready',
    contextChanges: [],
  });
  const applied = await applyProposal({ ...stored, idempotencyKey: randomUUID() });
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([{ revision: 3, briefing: '' }]);
});

it('undoes a change stored before the assumption existed', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites() },
  ]);
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  const [entry] = await connection()`select changes from host.changes where id = ${applied.id}`;
  const changes = (entry!.changes as { before: object | null; after: object | null }[]).map(
    (change) => ({
      ...change,
      before: change.before && withoutAssumption(change.before),
      after: change.after && withoutAssumption(change.after),
    }),
  );
  await connection()`update host.changes set changes = ${connection().json(changes as never)} where id = ${applied.id}`;
  await storeRecordsAsBeforeAssumption();
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).racePlans).toMatchObject([{ revision: 3, briefing: '' }]);
});

it('keeps a proposal read after the upgrade ready when the plan holds an assumption', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  await setAssumption(racePlanId, 1);
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 2, values: agentWrites() },
  ]);
  expect(await reviewProposal(submitted)).toMatchObject({
    applicability: 'ready',
    contextChanges: [],
  });
});

it('blocks a waiting proposal when the owner changes the assumption', async () => {
  const racePlanId = await createOwnerRacePlan(raceId, 'Finish comfortably');
  const { token } = await grantWithRace();
  const submitted = await submit(token, [
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites() },
  ]);
  await setAssumption(racePlanId, 1);
  expect(await reviewProposal(submitted)).toMatchObject({
    applicability: 'conflict',
    contextChanges: [{ entity: 'racePlan', id: racePlanId }],
  });
});
