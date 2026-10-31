import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import {
  connection,
  closeDatabase,
  transaction,
  readTransaction,
} from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import {
  createGrant,
  contextForToken,
  submitProposal,
  reviewProposal,
  applyProposal,
  undoChange,
  revokeGrant,
} from '../../plugins/agent-bridge/service';
import { readHistory } from '../../plugins/agent-bridge/history';
import * as sources from '../../instance/history-services';
import { annualRange, annualId, seedAnnualReview } from '../fixtures/annual-review';
import { syntheticDay } from '../fixtures/historical';
import { profileSchema } from '../../packages/contracts/src';

beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDatabase);

async function historyAccess() {
  const data = syntheticDay('2024-01-02', 0);
  for (const activity of data.activities)
    await connection()`insert into activity_records.records(kind,id,revision,data) values('activity',${activity.id},1,${connection().json(activity)})`;
  const access = await createGrant({
    label: 'Synthetic cache',
    version: 2,
    history: { from: '2024-01-01', to: '2024-12-31', categories: ['activities'], weekStartsOn: 1 },
    planning: null,
  });
  return { ...access, data };
}

it('reuses summaries without source scans while independently authorizing every cached page and filter', async () => {
  const { token, grant } = await historyAccess();
  const reads = vi.spyOn(sources, 'historicalRecords');
  const first = await readHistory(token, 'summary', { category: 'activities', limit: 1 });
  expect(first.nextCursor).not.toBeNull();
  expect(reads).toHaveBeenCalled();
  reads.mockClear();
  const nextInput = { ...first.query, reviewToken: first.reviewToken, cursor: first.nextCursor! };
  const next = await readHistory(token, 'summary', nextInput);
  expect(reads).not.toHaveBeenCalled();
  expect(next.summaries![0]).not.toEqual(first.summaries![0]);
  expect(await readHistory(token, 'summary', nextInput)).toEqual({
    ...next,
    nextCursor: expect.any(String),
  });
  await expect(
    readHistory(token, 'summary', { ...nextInput, sport: 'cycling' }),
  ).rejects.toMatchObject({ code: 'invalid_cursor' });
  await expect(
    readHistory(token, 'summary', { ...nextInput, category: 'health' }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(
    readHistory(token, 'summary', { ...nextInput, from: '2023-01-01' }),
  ).rejects.toMatchObject({ code: 'out_of_scope' });
  const other = await createGrant({
    label: 'Other',
    version: 2,
    history: { from: '2024-01-01', to: '2024-12-31', categories: ['activities'], weekStartsOn: 1 },
    planning: null,
  });
  await expect(readHistory(other.token, 'summary', nextInput)).rejects.toMatchObject({
    code: 'invalid_cursor',
  });
  await readHistory(other.token, 'summary', { category: 'activities', limit: 1 });
  expect(reads).toHaveBeenCalled();
  await revokeGrant({ id: grant.id });
  await expect(readHistory(token, 'summary', nextInput)).rejects.toMatchObject({
    code: 'invalid_grant',
  });
  await connection()`update host.grants set expires_at=clock_timestamp()-interval '1 second' where id=${other.grant.id}`;
  await expect(
    readHistory(other.token, 'summary', { category: 'activities', limit: 1 }),
  ).rejects.toMatchObject({ code: 'invalid_grant' });
});

it('invalidates cached summaries after a record change and recomputes on explicit restart', async () => {
  const { token, data } = await historyAccess();
  const first = await readHistory(token, 'summary', { category: 'activities', limit: 1 });
  await connection()`update activity_records.records set data=data||'{"durationSeconds":999}'::jsonb,revision=revision+1 where id=${data.activities[0]!.id}`;
  await expect(
    readHistory(token, 'summary', {
      ...first.query,
      reviewToken: first.reviewToken,
      cursor: first.nextCursor!,
    }),
  ).rejects.toMatchObject({ code: 'history_changed' });
  const restarted = await readHistory(token, 'summary', {
    category: 'activities',
    sport: 'running',
  });
  expect(
    restarted.summaries!.find((row) => row.category === 'activities')!.durationSeconds!.value,
  ).toBe(999);
});

it.each(['records', 'revoke', 'expiry', 'maintenance'] as const)(
  'does not block domain writes during a historical read and detects concurrent %s changes',
  async (change) => {
    const { token, grant, data } = await historyAccess();
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = sources.historicalRecords;
    vi.spyOn(sources, 'historicalRecords').mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      entered();
      await hold;
      return rows;
    });
    const pending = readHistory(token, 'summary', { category: 'activities' });
    const result = pending.then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await reached;
      await Promise.race([
        transaction(async (tx) => {
          if (change === 'records')
            await tx`update activity_records.records set revision=revision+1 where id=${data.activities[0]!.id}`;
          if (change === 'revoke')
            await tx`update host.grants set revoked=true where id=${grant.id}`;
          if (change === 'expiry')
            await tx`update host.grants set expires_at=clock_timestamp()-interval '1 second' where id=${grant.id}`;
          if (change === 'maintenance')
            await tx`insert into host.settings(key,value) values('maintenance','true')`;
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Historical read blocked the writer')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      release();
    }
    expect((await result).error).toMatchObject({
      code:
        change === 'records'
          ? 'history_changed'
          : change === 'maintenance'
            ? 'maintenance'
            : 'invalid_grant',
    });
  },
);

it('enforces read-only database transactions', async () => {
  expect(
    await readTransaction(async (tx) => ({
      isolation: (await tx`show transaction_isolation`)[0]!.transaction_isolation,
      readOnly: (await tx`show transaction_read_only`)[0]!.transaction_read_only,
    })),
  ).toEqual({ isolation: 'read committed', readOnly: 'on' });
  await expect(
    readTransaction(
      (tx) => tx`insert into host.settings(key,value) values('must-not-write','true')`,
    ),
  ).rejects.toMatchObject({ code: '25006' });
});

it('handles 1500 mixed annual commands with stale review, mid-write rollback, idempotent apply and whole-batch undo', async () => {
  const fixture = await connection().begin(seedAnnualReview);
  const profile = profileSchema.parse({ id: 'owner', revision: 1 });
  await connection()`insert into athlete.records(kind,id,revision,data) values('profile','owner',1,${connection().json(profile)})`;
  const { token } = await createGrant({
    label: 'Annual maximum',
    version: 2,
    history: null,
    planning: annualRange,
  });
  const context = await contextForToken(token),
    input = {
      commands: fixture.commands,
      summary: 'Maximum mixed year',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(4 * 1024 * 1024);
  await expect(
    submitProposal(token, { ...input, commands: [...fixture.commands, fixture.commands[0]] }),
  ).rejects.toThrow();
  const before =
    await connection()`select id,data,revision,deleted from training.records order by id`;
  const proposal = await submitProposal(token, input);
  expect(await submitProposal(token, input)).toEqual(proposal);
  expect(
    await connection()`select id,data,revision,deleted from training.records order by id`,
  ).toEqual(before);
  await connection()`update athlete.records set revision=2,data=data||'{"revision":2,"goals":"Changed since proposal"}'::jsonb where id='owner'`;
  const review = await reviewProposal({ id: proposal.id, digest: proposal.digest });
  expect(review.applicability).toBe('review-required');
  const apply = { id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() };
  await expect(applyProposal(apply)).rejects.toMatchObject({ code: 'stale_context' });
  const acknowledged = { ...apply, reviewedContextDigest: review.currentContextDigest! };
  await connection().unsafe(
    `create function training.synthetic_batch_failure() returns trigger language plpgsql as $$ begin if new.id='${annualId(3201)}' and new.deleted=false then raise exception 'synthetic batch failure'; end if; return new; end $$`,
  );
  await connection()`create trigger synthetic_batch_failure before insert or update on training.records for each row execute function training.synthetic_batch_failure()`;
  try {
    await expect(applyProposal(acknowledged)).rejects.toThrow('synthetic batch failure');
  } finally {
    await connection()`drop trigger synthetic_batch_failure on training.records`;
    await connection()`drop function training.synthetic_batch_failure()`;
  }
  expect(
    await connection()`select id,data,revision,deleted from training.records order by id`,
  ).toEqual(before);
  expect(await connection()`select id from host.changes`).toHaveLength(0);
  expect(
    (await connection()`select status from host.proposals where id=${proposal.id}`)[0]!.status,
  ).toBe('pending');
  const applied = await applyProposal(acknowledged);
  expect(await applyProposal(acknowledged)).toEqual(applied);
  expect(applied.changes).toHaveLength(1500);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  const restored =
    await connection()`select id,data from training.records where deleted=false order by id`;
  const withoutRevision = (rows: typeof restored) =>
    rows.map((row) => {
      const { revision: _revision, ...data } = row.data;
      return { id: row.id, data };
    });
  expect(withoutRevision(restored)).toEqual(withoutRevision(before));
}, 30000);
