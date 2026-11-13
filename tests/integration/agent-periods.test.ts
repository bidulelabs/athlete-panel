import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
import { canonical, digest } from '../../packages/host/src/crypto';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { readWorkspaceResponse } from '../../instance/workspace-response';
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
const range = { from: '2026-11-01', to: '2027-01-31' };
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,host.jobs,athlete.records,training.records,activity_records.records,garmin.coverage`;
});
afterAll(closeDatabase);

const weeklyHours = {
  firstWeek: { min: 28800, max: 32400 },
  lastWeek: { min: 36000, max: 39600 },
};
const periodValues = (values: Record<string, unknown> = {}) => ({
  name: 'Winter base',
  role: 'base',
  startDate: '2026-11-02',
  endDate: '2027-01-31',
  weeklyDurationSeconds: weeklyHours,
  ...values,
});
const createPeriod = (values: Record<string, unknown> = {}) => ({
  action: 'period.create',
  values: periodValues(values),
});
const access = (permission: boolean | undefined = true) =>
  createGrant({
    label: 'Synthetic season planning',
    version: 2,
    history: null,
    planning: {
      ...range,
      includeNotes: false,
      ...(permission === undefined ? {} : { allowPhaseChanges: permission }),
    },
  });
async function submit(token: string, commands: unknown[]) {
  const context = await contextForToken(token);
  const result = await submitProposal(token, {
    commands,
    summary: 'Plan phases',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  });
  return { id: result.id, digest: result.digest };
}
const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });

it.each([false, 'absent', 'legacy'])(
  'denies phase changes with %s permission',
  async (permission) => {
    const { token } =
      permission === 'legacy'
        ? await createGrant({ label: 'Legacy', ...range })
        : permission === 'absent'
          ? await createGrant({ label: 'Old modern', version: 2, history: null, planning: range })
          : await access(false);
    await expect(submit(token, [createPeriod()])).rejects.toMatchObject({ code: 'forbidden' });
    expect(await connection()`select id from host.proposals`).toHaveLength(0);
  },
);

it('reviews, applies and undoes a period within the proposal dates', async () => {
  const { token } = await access();
  const submitted = await submit(token, [createPeriod()]);
  expect((await loadWorkspace()).periods).toHaveLength(0);
  const details = await proposalDetails({ id: submitted.id });
  const list = await readWorkspaceResponse(range);
  expect(list.proposals.find((p) => p.id === submitted.id)?.dateBounds).toEqual({
    from: '2026-11-02',
    to: '2027-01-31',
  });
  expect(summarizeProposal(details.changes)).toMatchObject({
    from: '2026-11-02',
    to: '2027-01-31',
    added: 1,
  });
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).periods).toMatchObject([
    { name: 'Winter base', weeklyDurationSeconds: weeklyHours },
  ]);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).periods).toHaveLength(0);
});

it.each([{ startDate: '2026-10-31' }, { endDate: '2027-02-01' }])(
  'refuses a period reaching outside the proposal dates (%o)',
  async (dates) => {
    const { token } = await access();
    await expect(submit(token, [createPeriod(dates)])).rejects.toMatchObject({
      code: 'out_of_scope',
    });
  },
);

it('updates and deletes a period inside the proposal dates, refuses one outside them', async () => {
  const inside = randomUUID();
  const outside = randomUUID();
  await owner([
    { action: 'period.create', values: { id: inside, ...periodValues() } } as CommandInput,
    {
      action: 'period.create',
      values: {
        id: outside,
        ...periodValues({ name: 'Spring build', startDate: '2027-03-01', endDate: '2027-04-30' }),
      },
    } as CommandInput,
  ]);
  const { token } = await access();
  const updated = await submit(token, [
    { action: 'period.update', id: inside, expectedRevision: 1, values: { role: 'build' } },
  ]);
  await applyProposal({ ...updated, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).periods.find((p) => p.id === inside)).toMatchObject({
    role: 'build',
  });
  await expect(
    submit(token, [{ action: 'period.delete', id: outside, expectedRevision: 1 }]),
  ).rejects.toMatchObject({ code: 'out_of_scope' });
  const deleted = await submit(token, [
    { action: 'period.delete', id: inside, expectedRevision: 2 },
  ]);
  await applyProposal({ ...deleted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).periods.map((p) => p.id)).toEqual([outside]);
});

it('reviews and applies a phase proposal saved before edited weeks existed', async () => {
  const { token } = await access();
  const { id } = await submit(token, [createPeriod()]);
  const sql = connection();
  const [stored] = await sql<
    { commands: unknown; changes: unknown; summary: string; context: { digest: string } }[]
  >`select commands,changes,summary,context from host.proposals where id=${id}`;
  const withoutEditedWeeks = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (key, field) => (key === 'editedWeeks' ? undefined : field)));
  const commands = withoutEditedWeeks(stored!.commands);
  const changes = withoutEditedWeeks(stored!.changes);
  expect(JSON.stringify(changes)).not.toContain('editedWeeks');
  const proposalDigest = digest(
    canonical({
      commands,
      changes,
      contextDigest: stored!.context.digest,
      summary: stored!.summary,
    }),
  );
  await sql`update host.proposals set commands=${sql.json(commands)},changes=${sql.json(changes)},digest=${proposalDigest} where id=${id}`;
  const pending = { id, digest: proposalDigest };
  expect(await reviewProposal(pending)).toMatchObject({ applicability: 'ready' });
  await applyProposal({ ...pending, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).periods).toMatchObject([{ name: 'Winter base', editedWeeks: {} }]);
});

it('lets an agent edit one week of a phase with the phase permission, not without it', async () => {
  const phaseId = randomUUID();
  await owner([
    { action: 'period.create', values: { id: phaseId, ...periodValues() } } as CommandInput,
  ]);
  const lighterWeek = {
    action: 'period.update',
    id: phaseId,
    expectedRevision: 1,
    values: {
      editedWeeks: { '2026-11-16': { weeklyDurationSeconds: { min: 21600, max: 28800 } } },
    },
  };
  const { token: withoutPermission } = await access(false);
  await expect(submit(withoutPermission, [lighterWeek])).rejects.toMatchObject({
    code: 'forbidden',
  });
  const { token } = await access();
  const outsideThePhase = {
    ...lighterWeek,
    values: { editedWeeks: { '2027-02-08': { weeklyDurationSeconds: { min: 0, max: 1 } } } },
  };
  await expect(submit(token, [outsideThePhase])).rejects.toThrow(/inside their phase/);
  const submitted = await submit(token, [lighterWeek]);
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  const [phase] = (await loadWorkspace()).periods;
  expect(phase).toMatchObject({
    editedWeeks: lighterWeek.values.editedWeeks,
    weeklyDurationSeconds: weeklyHours,
  });
});
