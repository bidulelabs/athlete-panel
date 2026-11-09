import { isolatedDatabaseUrl } from '../support/test-database';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { canonical, digest } from '../../packages/host/src/crypto';
import { migrate } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';
import { mutate } from '../../plugins/training/service';
import {
  applyProposal,
  contextForToken,
  createGrant,
  revokeGrant,
  reviewProposal,
  submitProposal,
} from '../../plugins/agent-bridge/service';
import { PROPOSAL_LIFETIME_MS } from '../../packages/contracts/src';
import { syntheticDay } from '../fixtures/historical';
import agentBridge from '../../plugins/agent-bridge/server';
const url = isolatedDatabaseUrl();
const workoutId = '00000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDatabase);
async function readBeforeProposal() {
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'workout.create',
        values: {
          id: workoutId,
          title: 'Ride',
          sport: 'cycling',
          schedule: { kind: 'independent', date: '2026-10-24' },
          durationSeconds: 3600,
          notes: 'PRIVATE_WORKOUT_NOTE',
        },
      },
    ],
  });
  const grant = await createGrant({ label: 'Review test', from: '2026-10-19', to: '2026-10-25' });
  const context = await contextForToken(grant.token);
  const submit = (token = grant.token, contextDigest = context.contextDigest) =>
    submitProposal(token, {
      commands: [
        {
          action: 'workout.update',
          id: workoutId,
          expectedRevision: 1,
          values: { durationSeconds: 1800 },
        },
      ],
      summary: 'Shorten ride',
      contextDigest,
      idempotencyKey: randomUUID(),
    });
  return { grant, context, submit };
}
async function proposal() {
  const { grant, context, submit } = await readBeforeProposal();
  const submitted = await submit();
  return { grant, input: { id: submitted.id, digest: submitted.digest }, context };
}
async function health(value = 5000) {
  const sql = connection();
  const record = {
    id: '00000000-0000-4000-8000-000000000009',
    revision: 1,
    provider: 'garmin',
    externalId: '555:steps:2026-10-24',
    metric: 'steps',
    localDate: '2026-10-24',
    measuredAt: null,
    value,
  };
  await sql`insert into activity_records.records(kind,id,revision,data) values('health',${record.id},1,${sql.json(record)}) on conflict(kind,id) do update set data=excluded.data`;
}
async function importRun(date = '2026-10-24') {
  const sql = connection();
  const run = syntheticDay(date, 1).activities[0]!;
  await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${run.id},1,${sql.json(run)})`;
}
it.each(['activity', 'health'])(
  'saves the agent’s original read when %s arrives before submission',
  async (entity) => {
    const { grant, context, submit } = await readBeforeProposal();
    // A later read under the same grant must not replace the baseline for this draft.
    if (entity === 'activity') await importRun();
    else await health();
    const newer = await contextForToken(grant.token);
    expect(newer.contextDigest).not.toBe(context.contextDigest);
    const submitted = await submit();
    const input = { id: submitted.id, digest: submitted.digest };
    const sql = connection();
    const [stored] = await sql`select context from host.proposals where id=${input.id}`;
    expect(stored.context).toMatchObject({
      digest: context.contextDigest,
      snapshot: { activities: [], health: [] },
    });
    expect(JSON.stringify(stored.context)).not.toContain('PRIVATE_WORKOUT_NOTE');
    const review = await reviewProposal(input);
    expect(review.applicability).toBe('review-required');
    expect(review.contextChanges.map((c) => c.entity)).toEqual([entity]);
    expect(review.currentContextDigest).toBe(newer.contextDigest);
    const apply = { ...input, idempotencyKey: randomUUID() };
    await expect(applyProposal(apply)).rejects.toMatchObject({
      code: 'stale_context',
      status: 409,
    });
    expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(3600);
    await applyProposal({ ...apply, reviewedContextDigest: review.currentContextDigest });
    expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(1800);
  },
);
it('shows both unseen imports when another arrives between review and apply', async () => {
  const { submit } = await readBeforeProposal();
  await importRun();
  const submitted = await submit();
  const input = { id: submitted.id, digest: submitted.digest };
  const first = await reviewProposal(input);
  await health();
  await expect(
    applyProposal({
      ...input,
      idempotencyKey: randomUUID(),
      reviewedContextDigest: first.currentContextDigest,
    }),
  ).rejects.toMatchObject({ code: 'stale_context', status: 409 });
  const latest = await reviewProposal(input);
  expect(latest.contextChanges.map((c) => c.entity)).toEqual(['activity', 'health']);
  expect(latest.currentContextDigest).not.toBe(first.currentContextDigest);
});
it('keeps the daily health behind a weekly average in a version 3 proposal', async () => {
  const { token, grant } = await createGrant({
    label: 'Weekly health',
    version: 2,
    history: null,
    planning: { from: '2026-10-01', to: '2026-11-20' },
  });
  await health(5000);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  const read = await contextForToken(token).finally(() => vi.useRealTimers());
  expect(read.context.health).toEqual([]);
  expect(read.context.healthWeeks.map((w) => w.metrics.steps.average)).toContain(5000);
  await health(6500);
  const { id, digest } = await submitProposal(token, {
    commands: [{ action: 'plan.create', values: { title: 'Weekly run', startDate: '2026-11-15' } }],
    summary: 'Weekly plan',
    contextDigest: read.contextDigest,
    idempotencyKey: randomUUID(),
  });
  const sql = connection();
  const [stored] = await sql`select context from host.proposals where id=${id}`;
  expect(stored.context).toMatchObject({ version: 3, snapshot: { health: [{ value: 5000 }] } });
  await sql`update host.grants set expires_at=now() where id=${grant.id}`;
  await agentBridge.schedule();
  const review = await reviewProposal({ id, digest });
  expect(review).toMatchObject({
    applicability: 'review-required',
    contextChanges: [{ entity: 'health', before: { value: 5000 }, after: { value: 6500 } }],
  });
  await applyProposal({
    id,
    digest,
    idempotencyKey: randomUUID(),
    reviewedContextDigest: review.currentContextDigest,
  });
});
it('does not require renewed review for an import outside planning dates', async () => {
  const { submit } = await readBeforeProposal();
  await importRun('2026-10-18');
  const { id, digest } = await submit();
  expect(await reviewProposal({ id, digest })).toMatchObject({
    applicability: 'ready',
    contextChanges: [],
  });
});
it.each([
  { action: 'workout.update', id: workoutId, expectedRevision: 1, values: { title: 'Owner edit' } },
  {
    action: 'profile.set',
    expectedRevision: null,
    values: { displayName: 'Synthetic owner', timezone: 'Europe/Paris' },
  },
])('refuses a draft after an import and $action', async (command) => {
  const { submit } = await readBeforeProposal();
  await health();
  await mutate({ idempotencyKey: randomUUID(), commands: [command] });
  await expect(submit()).rejects.toMatchObject({ code: 'stale_context', status: 409 });
  expect(await connection()`select id from host.proposals`).toHaveLength(0);
});
it('rejects an unknown stale digest and one read only by another grant', async () => {
  const { submit, grant } = await readBeforeProposal();
  const other = await createGrant({ label: 'Other reader', from: '2026-10-19', to: '2026-10-25' });
  // Identical scopes currently hash to the same digest. Only the first grant read it.
  await expect(submit(other.token)).rejects.toMatchObject({ code: 'stale_context', status: 409 });
  await health();
  await contextForToken(other.token);
  for (const request of [() => submit(other.token), () => submit(grant.token, '0'.repeat(64))])
    await expect(request()).rejects.toMatchObject({ code: 'stale_context', status: 409 });
});
it('deduplicates redacted reads and discards temporary snapshots on revocation or expiry', async () => {
  const { grant } = await readBeforeProposal();
  const sql = connection();
  const reads = (id: string) =>
    sql`select snapshot from agent_bridge.planning_reads where grant_id=${id}`;
  await contextForToken(grant.token);
  const retained = await reads(grant.grant.id);
  expect(retained).toHaveLength(1);
  expect(JSON.stringify(retained)).not.toContain('PRIVATE_WORKOUT_NOTE');
  const stillActive = await createGrant({ label: 'Active', from: '2026-10-19', to: '2026-10-25' });
  await contextForToken(stillActive.token);
  await revokeGrant({ id: grant.grant.id });
  expect(await reads(grant.grant.id)).toHaveLength(0);
  await agentBridge.schedule();
  expect(await reads(stillActive.grant.id)).toHaveLength(1);
  await sql`update host.grants set expires_at=now() where id=${stillActive.grant.id}`;
  await agentBridge.schedule();
  expect(await reads(stillActive.grant.id)).toHaveLength(0);
});
it('allows owner application after agent access expires, while denying further reads/submission', async () => {
  const { grant, input } = await proposal();
  await connection()`update host.grants set expires_at=now()-interval '1 hour' where id=${grant.grant.id}`;
  await expect(contextForToken(grant.token)).rejects.toMatchObject({ code: 'invalid_grant' });
  await expect(
    submitProposal(grant.token, {
      commands: [{ action: 'workout.delete', id: workoutId, expectedRevision: 1 }],
      summary: 'Expired',
      contextDigest: 'a'.repeat(64),
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'invalid_grant' });
  expect((await reviewProposal(input)).applicability).toBe('ready');
  await applyProposal({ ...input, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(1800);
});
it('expires at precisely seven days and retains identical committed retries after expiry', async () => {
  const { input } = await proposal();
  const createdAt = new Date('2026-10-20T12:00:00Z');
  await connection()`update host.proposals set created_at=${createdAt} where id=${input.id}`;
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValue(createdAt.getTime() + PROPOSAL_LIFETIME_MS - 1);
  expect((await reviewProposal(input)).applicability).toBe('ready');
  clock.mockReturnValue(createdAt.getTime() + PROPOSAL_LIFETIME_MS);
  expect((await reviewProposal(input)).applicability).toBe('expired');
  const request = { ...input, idempotencyKey: randomUUID() };
  await expect(applyProposal(request)).rejects.toMatchObject({ code: 'proposal_expired' });
  clock.mockReturnValue(createdAt.getTime() + PROPOSAL_LIFETIME_MS - 1);
  const applied = await applyProposal(request);
  clock.mockReturnValue(createdAt.getTime() + PROPOSAL_LIFETIME_MS + 1000);
  expect(await applyProposal(request)).toEqual(applied);
});
it('still blocks a revoked grant after a successful review', async () => {
  const { grant, input } = await proposal();
  const review = await reviewProposal(input);
  await revokeGrant({ id: grant.grant.id });
  expect((await reviewProposal(input)).applicability).toBe('revoked');
  await expect(
    applyProposal({
      ...input,
      reviewedContextDigest: review.currentContextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'invalid_grant' });
});
it('requires fresh review of context-only changes and preserves the exact immutable edits', async () => {
  const { input } = await proposal();
  const [original] =
    await connection()`select commands,changes,context,digest from host.proposals where id=${input.id}`;
  expect(JSON.stringify(original.context)).not.toContain('PRIVATE_WORKOUT_NOTE');
  expect(original.context.version).toBe(2);
  await health();
  const review = await reviewProposal(input);
  expect(review.applicability).toBe('review-required');
  expect(review.contextChanges).toHaveLength(1);
  expect(review.contextChanges[0]?.entity).toBe('health');
  expect(JSON.stringify(review)).not.toContain('PRIVATE_WORKOUT_NOTE');
  const key = randomUUID();
  await expect(applyProposal({ ...input, idempotencyKey: key })).rejects.toMatchObject({
    code: 'stale_context',
  });
  const applied = await applyProposal({
    ...input,
    idempotencyKey: key,
    reviewedContextDigest: review.currentContextDigest,
  });
  expect(applied.changes).toEqual(original.changes);
  const [stored] =
    await connection()`select commands,changes,context,digest from host.proposals where id=${input.id}`;
  expect(stored).toEqual(original);
  expect((await loadWorkspace()).workouts[0]?.notes).toBe('PRIVATE_WORKOUT_NOTE');
});
it('rejects a further context change between review and apply without partial writes', async () => {
  const { input } = await proposal();
  await health();
  const review = await reviewProposal(input);
  await health(6500);
  const key = randomUUID();
  await expect(
    applyProposal({
      ...input,
      idempotencyKey: key,
      reviewedContextDigest: review.currentContextDigest,
    }),
  ).rejects.toMatchObject({ code: 'stale_context', status: 409 });
  expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(3600);
  expect(await connection()`select key from host.idempotency where key=${key}`).toHaveLength(0);
  const latest = await reviewProposal(input);
  await applyProposal({
    ...input,
    idempotencyKey: key,
    reviewedContextDigest: latest.currentContextDigest,
  });
});
it('requires replacement for conflicting mutations even with a fresh context digest', async () => {
  const { input } = await proposal();
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'workout.update',
        id: workoutId,
        expectedRevision: 1,
        values: { title: 'Owner changed this' },
      },
    ],
  });
  const review = await reviewProposal(input);
  expect(review.applicability).toBe('conflict');
  expect(review.conflicts).toHaveLength(1);
  await expect(
    applyProposal({
      ...input,
      idempotencyKey: randomUUID(),
      reviewedContextDigest: review.currentContextDigest,
    }),
  ).rejects.toMatchObject({ code: review.conflicts[0]?.code });
});
it('detects a changed expanded diff even when a record revision was not bumped', async () => {
  const { input } = await proposal();
  await connection()`update training.records set data=jsonb_set(data,'{title}','"Unexpected correction"') where id=${workoutId}`;
  const review = await reviewProposal(input);
  expect(review.applicability).toBe('conflict');
  expect(review.conflicts[0]).toMatchObject({
    code: 'proposal_changed',
    message:
      'The resulting edits differ from the proposed changes. Request a replacement proposal.',
  });
});
const planId = '00000000-0000-4000-8000-000000000001';
const mondayRunId = '00000000-0000-4000-8000-000000000003';
const thursdayIntervalsId = '00000000-0000-4000-8000-000000000004';
const shortenIntervals = {
  action: 'workout.update',
  id: thursdayIntervalsId,
  expectedRevision: 1,
  values: { durationSeconds: 3000 },
};
const renameMondayRun = {
  action: 'workout.update',
  id: mondayRunId,
  expectedRevision: 1,
  values: { title: 'Recovery run' },
};
const movePlanStart = {
  action: 'plan.update',
  id: planId,
  expectedRevision: 1,
  values: { startDate: '2026-10-20' },
};
async function planProposal(command: object) {
  const createPlanWorkout = (day: number, id: string, title: string) => ({
    action: 'workout.create',
    values: { id, title, sport: 'running', schedule: { kind: 'plan', planId, day } },
  });
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      { action: 'plan.create', values: { id: planId, title: 'Build', startDate: '2026-10-19' } },
      createPlanWorkout(1, mondayRunId, 'Easy run'),
      createPlanWorkout(4, thursdayIntervalsId, 'Intervals'),
    ],
  });
  const grant = await createGrant({ label: 'Plan test', from: '2026-10-19', to: '2026-10-25' });
  const submitted = await submitProposal(grant.token, {
    commands: [command],
    summary: 'Plan change',
    contextDigest: (await contextForToken(grant.token)).contextDigest,
    idempotencyKey: randomUUID(),
  });
  return { id: submitted.id, digest: submitted.digest };
}
it('applies a proposal on one plan workout once the owner reviews an edit of another workout', async () => {
  const input = await planProposal(shortenIntervals);
  await mutate({ idempotencyKey: randomUUID(), commands: [renameMondayRun] });
  const review = await reviewProposal(input);
  expect(review.applicability).toBe('review-required');
  expect(review.contextChanges.map((change) => change.id)).toEqual([mondayRunId]);
  const key = randomUUID();
  await expect(applyProposal({ ...input, idempotencyKey: key })).rejects.toMatchObject({
    code: 'stale_context',
  });
  await applyProposal({
    ...input,
    idempotencyKey: key,
    reviewedContextDigest: review.currentContextDigest,
  });
  const { workouts } = await loadWorkspace();
  expect(workouts.find((w) => w.id === thursdayIntervalsId)?.durationSeconds).toBe(3000);
  expect(workouts.find((w) => w.id === mondayRunId)?.title).toBe('Recovery run');
});
it.each([
  [
    'an owner edit of the proposed workout',
    shortenIntervals,
    { ...shortenIntervals, values: { title: 'Owner intervals' } },
    'STALE_REVISION',
  ],
  ['an owner move of the plan start', shortenIntervals, movePlanStart, 'STALE_REVISION'],
  [
    'an owner edit of a workout the proposed plan move shifts',
    movePlanStart,
    renameMondayRun,
    'proposal_changed',
  ],
])('still conflicts after %s', async (_, proposed, ownerCommand, code) => {
  const input = await planProposal(proposed);
  await mutate({ idempotencyKey: randomUUID(), commands: [ownerCommand] });
  const review = await reviewProposal(input);
  expect(review.applicability).toBe('conflict');
  expect(review.conflicts[0]?.code).toBe(code);
});
it.each([false, true])('handles legacy context with changed=%s', async (changed) => {
  const { input, context } = await proposal();
  await connection()`update host.proposals set context=${connection().json({ scope: context.scope, digest: context.contextDigest })} where id=${input.id}`;
  if (changed) await health();
  const review = await reviewProposal(input);
  expect(review.applicability).toBe(changed ? 'replacement-required' : 'ready');
  const request = {
    ...input,
    idempotencyKey: randomUUID(),
    reviewedContextDigest: review.currentContextDigest,
  };
  if (changed)
    await expect(applyProposal(request)).rejects.toMatchObject({ code: 'legacy_context_changed' });
  else await applyProposal(request);
});
it('reviews and applies a proposal saved before plan phases existed', async () => {
  const { input } = await proposal();
  const sql = connection();
  const [stored] = await sql<
    {
      context: { snapshot: Record<string, unknown> };
      commands: unknown;
      changes: unknown;
      summary: string;
    }[]
  >`select context,commands,changes,summary from host.proposals where id=${input.id}`;
  const { periods, ...snapshotBeforePhases } = stored!.context.snapshot;
  expect(periods).toEqual([]);
  const contextDigest = digest(canonical(snapshotBeforePhases));
  const proposalDigest = digest(
    canonical({
      commands: stored!.commands,
      changes: stored!.changes,
      contextDigest,
      summary: stored!.summary,
    }),
  );
  await sql`update host.proposals set digest=${proposalDigest},context=${sql.json({ ...stored!.context, digest: contextDigest, snapshot: snapshotBeforePhases } as never)} where id=${input.id}`;
  const pending = { id: input.id, digest: proposalDigest };
  expect(await reviewProposal(pending)).toMatchObject({
    applicability: 'ready',
    contextChanges: [],
  });
  await applyProposal({ ...pending, idempotencyKey: randomUUID() });
  expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(1800);
});
it('rejects tampering with stored commands while retaining the submitted digest', async () => {
  const { input } = await proposal();
  await connection()`update host.proposals set summary='Tampered summary' where id=${input.id}`;
  await expect(reviewProposal(input)).rejects.toMatchObject({ code: 'digest_mismatch' });
});
it('rolls back domain, audit, proposal and idempotency writes when audit persistence fails', async () => {
  const { input } = await proposal();
  const sql = connection();
  await sql`create function host.reject_review_test() returns trigger language plpgsql as 'begin raise exception ''synthetic audit failure''; end'`;
  await sql`create trigger reject_review_test before insert on host.changes for each row execute function host.reject_review_test()`;
  const key = randomUUID();
  try {
    await expect(applyProposal({ ...input, idempotencyKey: key })).rejects.toThrow(
      'synthetic audit failure',
    );
    expect((await loadWorkspace()).workouts[0]?.durationSeconds).toBe(3600);
    expect((await reviewProposal(input)).applicability).toBe('ready');
    expect(await sql`select key from host.idempotency where key=${key}`).toHaveLength(0);
  } finally {
    await sql`drop trigger reject_review_test on host.changes`;
    await sql`drop function host.reject_review_test()`;
  }
});
