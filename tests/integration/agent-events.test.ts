import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { isolatedDatabaseUrl } from '../support/test-database';
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
  await connection()`delete from host.settings where key in ('maintenance','garmin','onboarding','worker','lastBackup','backupAttempt','backupSchedule')`;
});
afterAll(closeDatabase);

const event = (values: Record<string, unknown> = {}) => ({
  action: 'event.create',
  values: { title: 'Winter race', date: '2027-01-31', kind: 'race', ...values },
});
const access = (permission: boolean | undefined = true, includeNotes = false) =>
  createGrant({
    label: 'Synthetic event planning',
    version: 2,
    history: null,
    planning: {
      ...range,
      includeNotes,
      ...(permission === undefined ? {} : { allowEventCreation: permission }),
    },
  });
async function draft(token: string, commands: unknown[] = [event()]) {
  const context = await contextForToken(token);
  const body = {
    commands,
    summary: 'Add race and prepare',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  };
  const result = await submitProposal(token, body);
  return { body, result, submitted: { id: result.id, digest: result.digest } };
}
const owner = (commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });

it.each([false, 'absent', 'legacy', 'history'])(
  'denies event creation with %s permission',
  async (permission) => {
    const { token } =
      permission === 'legacy'
        ? await createGrant({ label: 'Legacy', ...range })
        : permission === 'history'
          ? await createGrant({
              label: 'History',
              version: 2,
              planning: null,
              history: { ...range, categories: ['context'], weekStartsOn: 1 },
            })
          : permission === 'absent'
            ? await createGrant({ label: 'Old modern', version: 2, history: null, planning: range })
            : await access(false);
    const contextDigest =
      permission === 'history' ? 'a'.repeat(64) : (await contextForToken(token)).contextDigest;
    await expect(
      submitProposal(token, {
        commands: [event()],
        summary: 'Denied',
        contextDigest,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await connection()`select id from host.proposals`).toHaveLength(0);
    expect((await loadWorkspace()).events).toHaveLength(0);
  },
);

it('preserves a modern proposal whose saved scope predates event permission', async () => {
  const { token, grant } = await createGrant({
    label: 'Existing modern',
    version: 2,
    history: null,
    planning: range,
  });
  const { submitted } = await draft(token, [
    { action: 'plan.create', values: { title: 'Existing proposal', startDate: range.from } },
  ]);
  const [saved] = await connection()`select context from host.proposals where id=${submitted.id}`;
  expect(saved!.context.version).toBe(3);
  expect(saved!.context.scope).not.toHaveProperty('allowEventCreation');
  expect((await contextForToken(token)).scope).not.toHaveProperty('allowEventCreation');
  expect((await reviewProposal(submitted)).applicability).toBe('ready');
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  const [after] = await connection()`select scope from host.grants where id=${grant.id}`;
  expect(after!.scope.planning).not.toHaveProperty('allowEventCreation');
});

it.each([
  { kind: 'race', date: range.from },
  { kind: 'goal', date: range.to },
])('reviews an event-only $kind at the inclusive boundary $date', async (values) => {
  const { token } = await access();
  const { body, result, submitted } = await draft(token, [event(values)]);
  expect(await submitProposal(token, body)).toEqual(result);
  expect((await loadWorkspace()).events).toHaveLength(0);
  const details = await proposalDetails({ id: submitted.id });
  const list = await readWorkspaceResponse(range);
  expect(list.proposals.find((p) => p.id === submitted.id)?.dateBounds).toEqual({
    from: values.date,
    to: values.date,
  });
  expect(summarizeProposal(details.changes)).toMatchObject({
    from: values.date,
    to: values.date,
    added: 1,
  });
  expect(details.changes[0]).not.toHaveProperty('afterEffectiveDate');
  const applied = await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).events).toMatchObject([
    { ...values, title: 'Winter race', notes: '' },
  ]);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).events).toHaveLength(0);
});

it.each(['2026-10-31', '2027-02-01'])(
  'rejects event date %s outside proposal access',
  async (date) => {
    const { token } = await access();
    await expect(draft(token, [event({ date })])).rejects.toMatchObject({ code: 'out_of_scope' });
  },
);

it('enforces notes permission and preserves allowed notes through review and apply', async () => {
  const denied = await access();
  await expect(draft(denied.token, [event({ notes: 'Target description' })])).rejects.toMatchObject(
    { code: 'forbidden' },
  );
  const allowed = await access(true, true);
  const { submitted } = await draft(allowed.token, [event({ notes: 'Target description' })]);
  expect((await proposalDetails({ id: submitted.id })).changes[0]?.after).toMatchObject({
    notes: 'Target description',
  });
  await applyProposal({ ...submitted, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).events[0]?.notes).toBe('Target description');
  expect((await contextForToken(denied.token)).context.events[0]?.notes).toBe('');
});

it('rejects unsupported kinds and owner-only actions before storing a proposal', async () => {
  const { token } = await access();
  for (const command of [
    event({ kind: 'other' }),
    { action: 'event.update', id: randomUUID(), expectedRevision: 1, values: { title: 'No' } },
    { action: 'event.delete', id: randomUUID(), expectedRevision: 1 },
  ])
    await expect(draft(token, [command])).rejects.toThrow();
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});

it('blocks normalized duplicates across kinds and within the same batch', async () => {
  await owner([
    {
      action: 'event.create',
      values: { title: '  WINTER   race ', date: range.to, kind: 'other' },
    },
  ]);
  const { token } = await access();
  await expect(draft(token)).rejects.toMatchObject({ code: 'duplicate_event' });
  await expect(
    draft(token, [event({ title: 'New goal', kind: 'goal' }), event({ title: ' NEW\tGOAL ' })]),
  ).rejects.toMatchObject({ code: 'duplicate_event' });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
  // Distinct names on one date and the same name on a different date remain valid.
  await draft(token, [event({ title: 'Different target' }), event({ date: range.from })]);
});

it.each([
  ['composed', 'Trail des Écrins', 'Trail des E\u0301crins'],
  ['decomposed', 'Trail des E\u0301crins', 'Trail des Écrins'],
])('blocks Unicode-equivalent titles with a %s existing title', async (_, stored, proposed) => {
  await owner([
    { action: 'event.create', values: { title: stored, date: range.to, kind: 'other' } },
  ]);
  const { token } = await access();
  await expect(draft(token, [event({ title: proposed })])).rejects.toMatchObject({
    code: 'duplicate_event',
  });
  await expect(
    draft(token, [
      event({ title: stored, date: range.from }),
      event({ title: proposed, date: range.from, kind: 'goal' }),
    ]),
  ).rejects.toMatchObject({ code: 'duplicate_event' });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
  expect((await loadWorkspace()).events).toMatchObject([{ title: stored }]);
  // Canonical equivalence does not remove meaningful accents or merge different dates.
  await draft(token, [
    event({ title: 'Trail des Ecrins' }),
    event({ title: proposed, date: range.from }),
  ]);
});

const program = (title = 'Winter race'): CommandInput[] => {
  const planId = randomUUID();
  return [
    { action: 'event.create', values: { title, date: range.to, kind: 'race' } },
    {
      action: 'plan.create',
      values: { id: planId, title: 'Race preparation', startDate: range.from },
    },
    {
      action: 'workout.create',
      values: { title: 'Easy run', sport: 'running', schedule: { kind: 'plan', planId, day: 1 } },
    },
  ];
};
it.each([
  ['Winter race', 'WINTER RACE'],
  ['Trail des Écrins', 'Trail des E\u0301crins'],
  ['Trail des E\u0301crins', 'Trail des Écrins'],
])('blocks a later duplicate of %s even with context acknowledgement', async (title, duplicate) => {
  const { token } = await access();
  const { submitted } = await draft(token, program(title));
  await owner([
    { action: 'event.create', values: { title: duplicate, date: range.to, kind: 'goal' } },
  ]);
  const review = await reviewProposal(submitted);
  expect(review.applicability).toBe('conflict');
  expect(review.conflicts).toMatchObject([{ code: 'duplicate_event' }]);
  await expect(
    applyProposal({
      ...submitted,
      reviewedContextDigest: review.currentContextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'duplicate_event' });
  const state = await loadWorkspace();
  expect(state.events).toHaveLength(1);
  expect(state.plans).toHaveLength(0);
  expect(state.workouts).toHaveLength(0);
});

it.each([false, true])(
  'applies a mixed proposal atomically and handles undo with later event edit=%s',
  async (laterEdit) => {
    const { token } = await access();
    const { submitted } = await draft(token, program());
    const before = await loadWorkspace();
    expect([before.events.length, before.plans.length, before.workouts.length]).toEqual([0, 0, 0]);
    const request = { ...submitted, idempotencyKey: randomUUID() };
    const applied = await applyProposal(request);
    expect(await applyProposal(request)).toEqual(applied);
    const state = await loadWorkspace();
    expect([state.events.length, state.plans.length, state.workouts.length]).toEqual([1, 1, 1]);
    if (laterEdit) {
      await owner([
        {
          action: 'event.update',
          id: state.events[0]!.id,
          expectedRevision: 1,
          values: { title: 'Owner corrected race' },
        },
      ]);
      await expect(
        undoChange({ id: applied.id, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: 'undo_conflict' });
      expect((await loadWorkspace()).workouts).toHaveLength(1);
    } else {
      await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
      const undone = await loadWorkspace();
      expect([undone.events.length, undone.plans.length, undone.workouts.length]).toEqual([
        0, 0, 0,
      ]);
    }
  },
);

it('rolls back event, plan, workout, audit and application when persistence fails', async () => {
  const { token } = await access();
  const { submitted } = await draft(token, program());
  const sql = connection();
  await sql`create function host.reject_event_test() returns trigger language plpgsql as 'begin raise exception ''synthetic event audit failure''; end'`;
  await sql`create trigger reject_event_test before insert on host.changes for each row execute function host.reject_event_test()`;
  const key = randomUUID();
  try {
    await expect(applyProposal({ ...submitted, idempotencyKey: key })).rejects.toThrow(
      'synthetic event audit failure',
    );
    const state = await loadWorkspace();
    expect([state.events.length, state.plans.length, state.workouts.length]).toEqual([0, 0, 0]);
    expect(await sql`select id from host.changes`).toHaveLength(0);
    expect(await sql`select key from host.idempotency where key=${key}`).toHaveLength(0);
    expect((await reviewProposal(submitted)).applicability).toBe('ready');
  } finally {
    await sql`drop trigger reject_event_test on host.changes`;
    await sql`drop function host.reject_event_test()`;
  }
});
