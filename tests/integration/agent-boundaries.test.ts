import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { consumeRequestBudget } from '../../packages/host/src/request-budget';
import { failure } from '../../packages/host/src/http';
import { startConnection, cancelConnection } from '../../plugins/agent-bridge/connections';
import { contextForToken, submitProposal, createGrant } from '../../plugins/agent-bridge/service';

const supplied = process.env.TEST_DATABASE_URL;
if (
  !supplied ||
  !['localhost', '127.0.0.1'].includes(new URL(supplied).hostname) ||
  !new URL(supplied).pathname.endsWith('_test')
)
  throw new Error('Explicit isolated loopback TEST_DATABASE_URL ending in _test required.');
const policy = {
  namespace: 'agent-enrollment',
  clientLimit: 5,
  totalLimit: 30,
  windowSeconds: 600,
};
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = supplied;
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.request_budgets, agent_bridge.connections, host.proposals, host.grants`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterAll(closeDatabase);

it('serializes per-client admissions without spending the global allowance on rejected requests', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => consumeRequestBudget(policy, 'synthetic-client')),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  const [global] = await connection()`select count from host.request_budgets where key='global'`;
  expect(global.count).toBe(5);
  await consumeRequestBudget(policy, 'other-client');
  const rows = await connection()`select * from host.request_budgets`;
  expect(JSON.stringify(rows)).not.toContain('synthetic-client');
  expect(rows).toHaveLength(3);
});

it('caps overall admissions and does not grow the ledger for rejected new identities', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) => consumeRequestBudget(policy, `client-${i}`)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30);
  expect(await connection()`select key from host.request_budgets`).toHaveLength(31);
  await closeDatabase();
  let rejected: unknown;
  try {
    await consumeRequestBudget(policy, 'after-restart');
  } catch (error) {
    rejected = error;
  }
  const response = failure(rejected);
  expect(response.status).toBe(429);
  const seconds = Number(response.headers.get('Retry-After'));
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(600);
  expect(await response.json()).toMatchObject({
    error: { code: 'rate_limited', details: { retryAfterSeconds: seconds } },
  });
  await connection()`update host.request_budgets set reset_at=now()-interval '1 second'`;
  await consumeRequestBudget(policy, 'after-expiry');
  expect(await connection()`select key from host.request_budgets`).toHaveLength(2);
});

it('keeps admissions when validation or maintenance rejects enrollment', async () => {
  await expect(startConnection({ label: '' }, 'client')).rejects.toThrow();
  await connection()`insert into host.settings(key,value) values('maintenance','true')`;
  await expect(startConnection({ label: 'Synthetic' }, 'client')).rejects.toMatchObject({
    code: 'maintenance',
  });
  expect(await connection()`select id from agent_bridge.connections`).toHaveLength(0);
  const [global] = await connection()`select count from host.request_budgets where key='global'`;
  expect(global.count).toBe(2);
});

it('rejects invalid credentials and ignores unknown cancellation without waiting for the domain lock', async () => {
  await connection().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = Promise.all([
        expect(contextForToken('A'.repeat(43))).rejects.toMatchObject({ code: 'invalid_grant' }),
        expect(submitProposal('A'.repeat(43), {})).rejects.toMatchObject({ code: 'invalid_grant' }),
        expect(cancelConnection('A'.repeat(43))).resolves.toEqual({ ok: true }),
      ]);
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Invalid credentials waited for the domain lock')),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
});

it('rechecks revoked credentials after preflight while waiting for the transaction lock', async () => {
  for (const operation of ['context', 'propose']) {
    const { grant, token } = await createGrant({
      label: 'Synthetic',
      from: '2026-10-01',
      to: '2026-10-31',
      includeNotes: false,
      expiresInHours: 1,
    });
    let pending: Promise<unknown>;
    await connection().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(736147001)`;
      const request =
        operation === 'context'
          ? contextForToken(token)
          : submitProposal(token, {
              commands: [{ action: 'profile.set', expectedRevision: 1, values: {} }],
              summary: 'Synthetic',
              contextDigest: 'a'.repeat(64),
              idempotencyKey: randomUUID(),
            });
      pending = request.then(
        () => ({ unexpected: true }),
        (error: unknown) => error,
      );
      const deadline = Date.now() + 3000;
      while (true) {
        const [waiting] =
          await tx`select count(*)::int as count from pg_locks where locktype='advisory' and objid=736147001 and database=(select oid from pg_database where datname=current_database()) and granted=false`;
        if (waiting.count > 0) break;
        if (Date.now() >= deadline)
          throw new Error('Request never reached transactional authorization');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await tx`update host.grants set revoked=true where id=${grant.id}`;
    });
    expect(await pending!).toMatchObject({ code: 'invalid_grant', status: 401 });
  }
});
