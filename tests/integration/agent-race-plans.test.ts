import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
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

const url = isolatedDatabaseUrl();
const range = { from: '2026-11-01', to: '2027-06-30' };
const raceId = randomUUID();
const otherRaceId = randomUUID();
const raceAfterRangeId = randomUUID();
const courseId = randomUUID();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,host.jobs,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await owner([
    race(raceId, 'Synthetic mountain race', '2027-06-20'),
    race(otherRaceId, 'Synthetic spring race', '2027-04-04'),
    race(raceAfterRangeId, 'Synthetic autumn race', '2027-10-16'),
  ]);
});
afterAll(closeDatabase);

const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });
const race = (id: string, title: string, date: string): CommandInput => ({
  action: 'event.create',
  values: { id, title, kind: 'race', date },
});
const agentWrites = {
  briefing: 'Start easy, keep the long climb steady.',
  pacing: [{ fromMeters: 0, toMeters: 5000, effort: 'Easy' }],
  assumptions: ['Dry trail'],
  openQuestions: ['Poles allowed?'],
  courseId,
};
const createRacePlan = (eventId = raceId) => ({
  action: 'racePlan.create',
  values: { eventId, ...agentWrites },
});
const grantWithRace = (planning: Record<string, unknown> = { raceId }) =>
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
      { action: 'racePlan.update', id: otherPlan, expectedRevision: 1, values: agentWrites },
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
      briefing: agentWrites.briefing,
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
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites },
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
    { action: 'racePlan.update', id: racePlanId, expectedRevision: 1, values: agentWrites },
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
