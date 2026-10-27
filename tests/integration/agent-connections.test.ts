import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import {
  approveConnection,
  cancelConnection,
  denyConnection,
  inspectConnection,
  pollConnection,
  startConnection,
} from '../../plugins/agent-bridge/connections';
import { contextForToken, revokeGrant } from '../../plugins/agent-bridge/service';

const suppliedUrl = process.env.TEST_DATABASE_URL;
if (!suppliedUrl) throw new Error('An explicit isolated TEST_DATABASE_URL is required.');
const url = new URL(suppliedUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
  throw new Error('Connection tests require isolated loopback *_test storage.');

describe('browser-approved agent connections', () => {
  beforeAll(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = suppliedUrl;
    await migrate();
  });
  beforeEach(async () => {
    await connection()`truncate agent_bridge.connections, host.proposals, host.grants, host.request_budgets`;
    await connection()`delete from host.settings where key='maintenance'`;
  });
  afterAll(closeDatabase);
  const start = () => startConnection({ label: 'Synthetic terminal' });
  const approval = (request: { id: string; code: string }) => ({
    id: request.id,
    code: request.code,
    label: 'Approved agent',
    from: '2026-10-01',
    to: '2026-10-31',
    includeNotes: false,
    expiresInHours: 1,
  });

  it('issues no authority before owner approval and never exposes the secret in browser data/storage', async () => {
    const request = await start();
    await expect(contextForToken(request.token)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await connection()`select * from host.grants`).toHaveLength(0);
    expect(
      JSON.stringify(await connection()`select * from agent_bridge.connections`),
    ).not.toContain(request.token);
    const inspection = await inspectConnection({ id: request.id });
    expect(inspection).toMatchObject({ status: 'pending', code: request.code, grant: null });
    expect(JSON.stringify(inspection)).not.toContain(request.token);
    expect(JSON.stringify(inspection)).not.toContain('token_hash');
    await expect(pollConnection('A'.repeat(43))).rejects.toMatchObject({ status: 401 });
  });

  it('atomically approves once, polls successfully, and reuses the ordinary scoped grant permissions', async () => {
    const request = await start();
    const results = await Promise.all([
      approveConnection(approval(request)),
      approveConnection(approval(request)),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe('approved');
    expect(await connection()`select * from host.grants`).toHaveLength(1);
    expect(await pollConnection(request.token)).toEqual(results[0]);
    expect((await contextForToken(request.token)).scope).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      includeNotes: false,
    });
    await expect(
      approveConnection({ ...approval(request), includeNotes: true }),
    ).rejects.toMatchObject({ code: 'connection_conflict' });
    await revokeGrant({ id: results[0].grant!.id });
    await expect(contextForToken(request.token)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects mismatched codes, invalid scope, and forged connection identifiers without issuing grants', async () => {
    const request = await start();
    await expect(
      approveConnection({
        ...approval(request),
        code: request.code === '0000-0000' ? '1111-1111' : '0000-0000',
      }),
    ).rejects.toMatchObject({ code: 'code_mismatch' });
    await expect(approveConnection({ ...approval(request), to: '2027-12-31' })).rejects.toThrow();
    await expect(
      approveConnection({ ...approval(request), id: randomUUID() }),
    ).rejects.toMatchObject({ code: 'connection_expired' });
    expect(await connection()`select * from host.grants`).toHaveLength(0);
  });

  it('keeps a declined request unusable and reports denial to its originating terminal', async () => {
    const request = await start();
    await denyConnection({ id: request.id });
    expect(await pollConnection(request.token)).toMatchObject({ status: 'denied', grant: null });
    await expect(approveConnection(approval(request))).rejects.toMatchObject({
      code: 'connection_unavailable',
    });
    await cancelConnection(request.token);
    expect(await inspectConnection({ id: request.id })).toMatchObject({ status: 'denied' });
    expect(await connection()`select * from host.grants`).toHaveLength(0);
  });

  it('expires abandoned requests and retains the separate expiration of approved grants', async () => {
    const request = await start();
    await connection()`update agent_bridge.connections set expires_at=now()-interval '1 second' where id=${request.id}`;
    expect(await pollConnection(request.token)).toMatchObject({ status: 'expired' });
    await expect(approveConnection(approval(request))).rejects.toMatchObject({
      code: 'connection_expired',
    });
    const next = await start(),
      approved = await approveConnection(approval(next));
    await connection()`update host.grants set expires_at=now()-interval '1 second' where id=${approved.grant!.id}`;
    expect(await pollConnection(next.token)).toMatchObject({ status: 'expired' });
    await expect(contextForToken(next.token)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('cancellation cannot leave an unsaved approved grant active', async () => {
    const request = await start();
    await approveConnection(approval(request));
    await cancelConnection(request.token);
    await expect(contextForToken(request.token)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await pollConnection(request.token)).toMatchObject({ status: 'cancelled' });
    await expect(approveConnection(approval(request))).rejects.toMatchObject({
      code: 'connection_unavailable',
    });
  });

  it('limits unauthenticated enrollment volume and asks excessively fast pollers to slow down', async () => {
    const request = await start();
    expect(await pollConnection(request.token)).toMatchObject({ status: 'pending' });
    expect(await pollConnection(request.token)).toEqual({ status: 'slow_down' });
    for (let i = 1; i < 5; i++) await start();
    await expect(start()).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  });
});
