import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { mutate } from '../../plugins/training/service';
import { contextForToken, createGrant, submitProposal } from '../../plugins/agent-bridge/service';
import { readHistory } from '../../plugins/agent-bridge/history';

const url = isolatedDatabaseUrl();
const range = { from: '2026-11-01', to: '2027-06-30' };
const raceId = randomUUID();
const nutrition = {
  products: [
    {
      id: randomUUID(),
      name: 'Synthetic citrus gel',
      kind: 'gel',
      carbohydrateGrams: 30,
      fluidMillilitres: null,
      sodiumMilligrams: 50,
      caffeineMilligrams: 0,
      source: 'label',
      tolerance: 'comfortable',
    },
  ],
  carryCapacityMillilitres: 1000,
  preferences: 'PRIVATE_DIET',
};
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,athlete.records,training.records`;
  await owner([
    { action: 'profile.set', expectedRevision: null, values: { displayName: 'Synthetic owner' } },
    {
      action: 'event.create',
      values: { id: raceId, title: 'Synthetic race', kind: 'race', date: '2027-06-20' },
    },
  ]);
});
afterAll(closeDatabase);

const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });
const saveNutrition = () =>
  owner([{ action: 'profile.set', expectedRevision: 1, values: { nutrition } } as CommandInput]);
const planningGrant = (planning: Record<string, unknown>) =>
  createGrant({
    label: 'Synthetic planning',
    version: 2,
    history: null,
    planning: { ...range, includeNotes: true, ...planning },
  });
const propose = (token: string, contextDigest: string) =>
  submitProposal(token, {
    commands: [{ action: 'plan.create', values: { title: 'Base', startDate: '2026-11-02' } }],
    summary: 'Base block',
    contextDigest,
    idempotencyKey: randomUUID(),
  });

it('keeps nutrition out of a grant without a race, and a profile save still needs a new read', async () => {
  const { token } = await planningGrant({});
  const before = await contextForToken(token);
  await saveNutrition();
  const after = await contextForToken(token);
  expect(after.context.profile).not.toHaveProperty('nutrition');
  expect(JSON.stringify(after)).not.toContain('PRIVATE_DIET');
  await expect(propose(token, before.contextDigest)).rejects.toMatchObject({
    code: 'stale_context',
  });
  await expect(propose(token, after.contextDigest)).resolves.toMatchObject({ status: 'pending' });
});

it('shares nutrition with a race grant and asks for a new read once it changes', async () => {
  const { token } = await planningGrant({ raceId });
  const before = await contextForToken(token);
  expect(before.context.profile).not.toHaveProperty('nutrition');
  await saveNutrition();
  const after = await contextForToken(token);
  expect(after.context.profile?.nutrition).toEqual(nutrition);
  expect(after.contextDigest).not.toBe(before.contextDigest);
  await expect(propose(token, before.contextDigest)).rejects.toMatchObject({
    code: 'stale_context',
  });
});

it('leaves nutrition out of the history profile', async () => {
  await saveNutrition();
  const { token } = await createGrant({
    label: 'Synthetic history',
    version: 2,
    history: {
      from: '2021-10-31',
      to: '2026-10-31',
      categories: ['context'],
      includeNotes: true,
      weekStartsOn: 1,
    },
    planning: null,
  });
  const history = await readHistory(token, 'context');
  expect(history.profile?.displayName).toBe('Synthetic owner');
  expect(history.profile).not.toHaveProperty('nutrition');
});
