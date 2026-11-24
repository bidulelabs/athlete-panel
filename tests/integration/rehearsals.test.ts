import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { readWorkspaceResponse } from '../../instance/workspace-response';
import { mutate, undoChange } from '../../plugins/training/service';
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
const workoutId = randomUUID();
const rehearsalId = randomUUID();
const planId = randomUUID();
const run = (...commands: CommandInput[]) =>
  mutate({ idempotencyKey: randomUUID(), commands }) as Promise<{ id: string }>;
const rehearsal = {
  id: rehearsalId,
  eventId: raceId,
  workoutId,
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
  stomach: 'comfortable' as const,
  conditions: '14 °C, dry',
  lesson: 'Same gels next time.',
};
async function logRehearsal() {
  await run(
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    {
      action: 'workout.create',
      values: {
        id: workoutId,
        title: 'Long trail',
        sport: 'running',
        schedule: { kind: 'independent', date: '2026-10-24' },
      },
    },
  );
  await run({
    action: 'workout.complete',
    id: workoutId,
    expectedRevision: 1,
    values: { status: 'completed', performedDate: '2026-10-24', durationSeconds: 9600 },
  });
  await run({ action: 'rehearsal.create', values: rehearsal });
}

it('stores a rehearsal and returns it with the workspace', async () => {
  await logRehearsal();
  const { state } = await readWorkspaceResponse({ from: '2026-10-01', to: '2026-10-31' });
  expect(state.rehearsals).toEqual([{ ...rehearsal, revision: 1 }]);
  expect(state.workouts[0]!.completion).toMatchObject({ status: 'completed' });
});

it('deletes the rehearsal with its race and restores both on undo', async () => {
  await logRehearsal();
  const deleted = await run({ action: 'event.delete', id: raceId, expectedRevision: 1 });
  expect((await loadWorkspace()).rehearsals).toEqual([]);
  await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
  const restored = await loadWorkspace();
  expect(restored.events.map((event) => event.id)).toEqual([raceId]);
  expect(restored.rehearsals).toMatchObject([{ id: rehearsalId, lesson: rehearsal.lesson }]);
});

it('refuses to restore a rehearsal whose session was deleted afterwards', async () => {
  await logRehearsal();
  const deleted = await run({ action: 'event.delete', id: raceId, expectedRevision: 1 });
  await run({ action: 'workout.clearCompletion', id: workoutId, expectedRevision: 2 });
  await run({ action: 'workout.delete', id: workoutId, expectedRevision: 3 });
  await expect(undoChange({ id: deleted.id, idempotencyKey: randomUUID() })).rejects.toThrow(
    'A fueling rehearsal needs its session.',
  );
  const unchanged = await loadWorkspace();
  expect(unchanged.events).toEqual([]);
  expect(unchanged.rehearsals).toEqual([]);
});

async function logRehearsalOnPlanSession() {
  await run(
    {
      action: 'event.create',
      values: { id: raceId, title: 'Alpine Trail 42', kind: 'race', date: '2027-08-29' },
    },
    { action: 'plan.create', values: { id: planId, title: 'Build', startDate: '2026-10-19' } },
    {
      action: 'workout.create',
      values: {
        id: workoutId,
        title: 'Long trail',
        sport: 'running',
        schedule: { kind: 'plan', planId, day: 6 },
      },
    },
  );
  await run({
    action: 'workout.complete',
    id: workoutId,
    expectedRevision: 1,
    values: { status: 'completed', performedDate: '2026-10-24', durationSeconds: 9600 },
  });
  await run({ action: 'rehearsal.create', values: rehearsal });
  await run({ action: 'workout.clearCompletion', id: workoutId, expectedRevision: 2 });
}

it('restores the rehearsal on undo of its session deletion', async () => {
  await logRehearsal();
  await run({ action: 'workout.clearCompletion', id: workoutId, expectedRevision: 2 });
  const deleted = await run({ action: 'workout.delete', id: workoutId, expectedRevision: 3 });
  expect((await loadWorkspace()).rehearsals).toEqual([]);
  await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
  const restored = await loadWorkspace();
  expect(restored.workouts.map((workout) => workout.id)).toEqual([workoutId]);
  expect(restored.rehearsals).toMatchObject([{ id: rehearsalId, lesson: rehearsal.lesson }]);
});

it('restores the rehearsal on undo of the deletion of the plan holding its session', async () => {
  await logRehearsalOnPlanSession();
  const deleted = await run({ action: 'plan.delete', id: planId, expectedRevision: 1 });
  expect((await loadWorkspace()).rehearsals).toEqual([]);
  await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
  const restored = await loadWorkspace();
  expect(restored.plans.map((plan) => plan.id)).toEqual([planId]);
  expect(restored.rehearsals).toMatchObject([{ id: rehearsalId, lesson: rehearsal.lesson }]);
});

it('refuses an agent proposal that would delete a session holding a rehearsal', async () => {
  await logRehearsal();
  await run({ action: 'workout.clearCompletion', id: workoutId, expectedRevision: 2 });
  const { token } = await createGrant({
    label: 'Synthetic planning',
    version: 2,
    history: null,
    planning: { from: '2026-10-01', to: '2026-12-31', includeNotes: false },
  });
  const context = await contextForToken(token);
  await expect(
    submitProposal(token, {
      commands: [{ action: 'workout.delete', id: workoutId, expectedRevision: 3 }],
      summary: 'Remove the long trail',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({
    code: 'forbidden',
    message: 'This change would delete fueling rehearsals. Only the owner can delete them.',
  });
  expect((await loadWorkspace()).rehearsals).toHaveLength(1);
});
