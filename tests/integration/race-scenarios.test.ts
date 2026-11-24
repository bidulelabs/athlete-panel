import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { mutate, undoChange } from '../../plugins/training/service';
import { recentChanges } from '../../plugins/training/history-read';
import { contextForToken, createGrant, submitProposal } from '../../plugins/agent-bridge/service';

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
const run = (...commands: CommandInput[]) =>
  mutate({ idempotencyKey: randomUUID(), commands }) as Promise<{ id: string }>;
const scenario = (name: string): CommandInput => ({
  action: 'raceScenario.create',
  values: {
    id: randomUUID(),
    eventId: raceId,
    name,
    effortPercent: 5,
    weatherPercent: 0,
    weatherNote: '',
    stops: [{ stationId, stopSeconds: 600 }],
    basedOn: { courseId: null, stations: [{ id: stationId, distanceMeters: 12000 }] },
  },
});
const createdId = (command: CommandInput) =>
  (command as { values: { id: string } }).values.id as string;
async function raceWithPlan() {
  await run(
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    { action: 'racePlan.create', values: { id: racePlanId, eventId: raceId } },
  );
}
const auditRows = () => connection()`select id,undone_at from host.changes order by id`;

it('deletes the scenarios with their race and restores both on undo', async () => {
  await raceWithPlan();
  const first = scenario('Cautious');
  await run(first);
  const deleted = await run({ action: 'event.delete', id: raceId, expectedRevision: 1 });
  expect((await loadWorkspace()).raceScenarios).toEqual([]);
  await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
  const restored = await loadWorkspace();
  expect(restored.events.map((event) => event.id)).toEqual([raceId]);
  expect(restored.raceScenarios).toMatchObject([{ id: createdId(first), name: 'Cautious' }]);
});

it('refuses to undo the deletion of a scenario once the race holds four others', async () => {
  await raceWithPlan();
  const four = ['A', 'B', 'C', 'D'].map(scenario);
  await run(...four);
  const deleted = await run({
    action: 'raceScenario.delete',
    id: createdId(four[0]!),
    expectedRevision: 1,
  });
  await run(scenario('E'));
  const recordsBefore = await loadWorkspace();
  const auditBefore = await auditRows();
  await expect(undoChange({ id: deleted.id, idempotencyKey: randomUUID() })).rejects.toThrow(
    'A race holds at most 4 scenarios.',
  );
  expect(await loadWorkspace()).toEqual(recordsBefore);
  expect(await auditRows()).toEqual(auditBefore);
});

it('names the scenario in history', async () => {
  await raceWithPlan();
  await run(scenario('Hot afternoon'));
  expect((await recentChanges()).map((entry) => entry.title)).toContain('Created Hot afternoon');
});

async function raceGrant() {
  return createGrant({
    label: 'Synthetic race preparation',
    version: 2,
    history: null,
    planning: { from: '2027-06-01', to: '2027-12-31', includeNotes: false, raceId },
  });
}

it('leaves the race plan revision and an assistant context digest unchanged', async () => {
  await raceWithPlan();
  const { token } = await raceGrant();
  const contextBefore = await contextForToken(token);
  await run(scenario('Cautious'));
  const contextAfter = await contextForToken(token);
  expect(contextAfter.contextDigest).toBe(contextBefore.contextDigest);
  expect(JSON.stringify(contextAfter)).not.toContain('Cautious');
  expect((await loadWorkspace()).racePlans[0]!.revision).toBe(1);
});

it('refuses an assistant proposal that creates a scenario', async () => {
  await raceWithPlan();
  const { token } = await raceGrant();
  const context = await contextForToken(token);
  await expect(
    submitProposal(token, {
      commands: [scenario('Sneaky')],
      summary: 'Add a scenario',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow('No matching discriminator');
  expect((await loadWorkspace()).raceScenarios).toEqual([]);
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});
