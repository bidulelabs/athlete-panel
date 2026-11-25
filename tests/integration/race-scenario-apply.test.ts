import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { mutate, undoChange } from '../../plugins/training/service';
import {
  contextForToken,
  createGrant,
  reviewProposal,
  submitProposal,
} from '../../plugins/agent-bridge/service';
import { applyScenarioCommand } from '../../plugins/race-analysis/scenario-form';

const url = isolatedDatabaseUrl();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,athlete.records,training.records`;
});
afterAll(closeDatabase);

const raceId = randomUUID();
const racePlanId = randomUUID();
const stationId = randomUUID();
const scenarioId = randomUUID();
const run = (...commands: CommandInput[]) =>
  mutate({ idempotencyKey: randomUUID(), commands }) as Promise<{ id: string }>;
const station = {
  id: stationId,
  name: 'Synthetic hut',
  distanceMeters: 12000,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
};
const scenario = (values: Record<string, unknown> = {}): CommandInput => ({
  action: 'raceScenario.create',
  values: {
    id: scenarioId,
    eventId: raceId,
    name: 'Hot afternoon',
    effortPercent: 5,
    weatherPercent: 3,
    weatherNote: 'Hot valley',
    stops: [{ stationId, stopSeconds: 180 }],
    basedOn: { courseId: null, stations: [{ id: stationId, distanceMeters: 12000 }] },
    ...values,
  },
});
async function raceWithPlanAndScenario(scenarioValues: Record<string, unknown> = {}) {
  await run(
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    { action: 'racePlan.create', values: { id: racePlanId, eventId: raceId } },
  );
  await run({
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision: 1,
    values: { stations: [station] },
  });
  await run(scenario(scenarioValues));
}
const savedPlanAndScenario = async () => {
  const { racePlans, raceScenarios } = await loadWorkspace();
  return { plan: racePlans[0]!, scenario: raceScenarios[0]! };
};
const applyScenario = async () => {
  const { plan, scenario: saved } = await savedPlanAndScenario();
  return run(applyScenarioCommand(plan, saved));
};
const changeRows = () => connection()`select id from host.changes`;
const raceGrant = () =>
  createGrant({
    label: 'Synthetic race preparation',
    version: 2,
    history: null,
    planning: { from: '2027-06-01', to: '2027-12-31', includeNotes: false, raceId },
  });

it('applies a scenario as one change and gives the plan back on undo', async () => {
  await raceWithPlanAndScenario();
  const { plan: before } = await savedPlanAndScenario();
  const changesBefore = await changeRows();
  const applied = await applyScenario();
  expect(await changeRows()).toHaveLength(changesBefore.length + 1);
  expect((await savedPlanAndScenario()).plan).toMatchObject({
    effortPercent: 5,
    weatherPercent: 3,
    weatherNote: 'Hot valley',
    stations: [{ id: stationId, stopSeconds: 180, name: 'Synthetic hut' }],
  });
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  const { revision: _revisionBefore, ...planBefore } = before;
  const { revision: _revisionAfter, ...planAfter } = (await savedPlanAndScenario()).plan;
  expect(planAfter).toEqual(planBefore);
});

it('refuses to apply on a plan that changed since the dialog opened, and changes nothing', async () => {
  await raceWithPlanAndScenario();
  const { plan, scenario: saved } = await savedPlanAndScenario();
  await run({
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision: plan.revision,
    values: { target: 'Finish' },
  });
  const recordsBefore = await loadWorkspace();
  const changesBefore = await changeRows();
  await expect(run(applyScenarioCommand(plan, saved))).rejects.toMatchObject({
    code: 'STALE_REVISION',
  });
  expect(await loadWorkspace()).toEqual(recordsBefore);
  expect(await changeRows()).toEqual(changesBefore);
});

it('keeps effort and weather out of the context of a race grant when they are applied', async () => {
  await raceWithPlanAndScenario({ stops: [{ stationId, stopSeconds: 300 }] });
  const { token } = await raceGrant();
  const contextBefore = await contextForToken(token);
  await applyScenario();
  expect((await savedPlanAndScenario()).plan).toMatchObject({ effortPercent: 5, revision: 3 });
  const { revision: _revisionBefore, ...planBefore } = contextBefore.context.racePlans![0]!;
  const { revision: _revisionAfter, ...planAfter } = (await contextForToken(token)).context
    .racePlans![0]!;
  expect(planAfter).toEqual(planBefore);
});

it('asks for a new review of an assistant proposal waiting on the plan', async () => {
  await raceWithPlanAndScenario();
  const { token } = await raceGrant();
  const context = await contextForToken(token);
  const submitted = await submitProposal(token, {
    commands: [
      {
        action: 'racePlan.update',
        id: racePlanId,
        expectedRevision: 2,
        values: { briefing: 'Start easy.', courseId: null },
      },
    ],
    summary: 'Prepare the race',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  });
  expect(await reviewProposal({ id: submitted.id, digest: submitted.digest })).toMatchObject({
    applicability: 'ready',
  });
  await applyScenario();
  expect(await reviewProposal({ id: submitted.id, digest: submitted.digest })).toMatchObject({
    applicability: 'conflict',
  });
});
