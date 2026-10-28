import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, connection } from '../../packages/host/src/db';
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
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('Explicit loopback *_test database required');
const workoutId = '00000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDatabase);
async function proposal() {
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
  const submitted = await submitProposal(grant.token, {
    commands: [
      {
        action: 'workout.update',
        id: workoutId,
        expectedRevision: 1,
        values: { durationSeconds: 1800 },
      },
    ],
    summary: 'Shorten ride',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  });
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
async function activity(durationSeconds = 3000) {
  const sql = connection();
  const record = {
    id: '00000000-0000-4000-8000-000000000010',
    revision: 1,
    provider: 'garmin',
    externalId: '555:activity:1',
    title: 'Synthetic ride',
    sport: 'cycling',
    startedAt: '2026-10-24T08:00:00Z',
    localDate: '2026-10-24',
    dateSource: 'provider',
    durationSeconds,
    distanceMeters: null,
    elevationMeters: null,
    averageHeartRateBpm: null,
  };
  await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${record.id},1,${sql.json(record)}) on conflict(kind,id) do update set data=excluded.data`;
}
it.each([
  { imported: 'health', importRecord: health, importAgain: () => health(6500) },
  { imported: 'activity', importRecord: activity, importAgain: () => activity(3300) },
])(
  'accepts a submission after a new $imported record, then asks the owner to review it',
  async ({ importRecord, importAgain }) => {
    const { grant } = await proposal();
    const context = await contextForToken(grant.token);
    await importRecord();
    const submitted = await submitProposal(grant.token, {
      commands: [{ action: 'workout.delete', id: workoutId, expectedRevision: 1 }],
      summary: 'Drop ride',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    const input = { id: submitted.id, digest: submitted.digest };
    expect((await reviewProposal(input)).applicability).toBe('ready');
    await importAgain();
    expect((await reviewProposal(input)).applicability).toBe('review-required');
  },
);
it('refuses a submission after a training change since the context was read', async () => {
  const { grant } = await proposal();
  const context = await contextForToken(grant.token);
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      { action: 'workout.update', id: workoutId, expectedRevision: 1, values: { title: 'Easy' } },
    ],
  });
  await expect(
    submitProposal(grant.token, {
      commands: [{ action: 'workout.delete', id: workoutId, expectedRevision: 2 }],
      summary: 'Drop ride',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'stale_context' });
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
  expect(review.conflicts[0]?.code).toBe('proposal_changed');
});
it.each([false, true])('handles legacy context with changed=%s', async (changed) => {
  const { input } = await proposal();
  await connection()`update host.proposals set context=jsonb_build_object('scope',context->'scope','digest',context->'digest') where id=${input.id}`;
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
