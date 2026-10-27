import { requiredRow } from '../../packages/host/src/rows';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  agentConnectionApprovalSchema,
  agentConnectionIdSchema,
  agentConnectionStartSchema,
  agentConnectionStatusSchema,
  agentScopeSchema,
  type AgentConnectionStatus,
} from '../../packages/contracts/src';
import { connection, transaction, type Transaction } from '../../packages/host/src/db';
import { canonical, digest, randomToken } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import { consumeRequestBudget } from '../../packages/host/src/request-budget';

type ConnectionRow = {
  id: string;
  token_hash: string;
  label: string;
  code: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  grant_id: string | null;
  approval: unknown;
  expires_at: Date;
};

// No grant exists until the signed-in owner approves. The browser never receives the token.
export async function startConnection(body: unknown, client = 'local') {
  await consumeRequestBudget(
    { namespace: 'agent-enrollment', windowSeconds: 600, clientLimit: 5, totalLimit: 30 },
    client,
  );
  const { label } = agentConnectionStartSchema.parse(body);
  return transaction(async (tx) => {
    await tx`delete from agent_bridge.connections where created_at < now() - interval '1 day'`;
    const token = randomToken(),
      id = randomUUID();
    const value = randomBytes(4).toString('hex').toUpperCase();
    const code = `${value.slice(0, 4)}-${value.slice(4)}`;
    const row = requiredRow(
      await tx<
        { expires_at: Date }[]
      >`insert into agent_bridge.connections(id,token_hash,label,code) values(${id},${digest(token)},${label},${code}) returning expires_at`,
    );
    return {
      id,
      token,
      code,
      expiresAt: row.expires_at.toISOString(),
      pollIntervalSeconds: 2 as const,
    };
  });
}

async function publicStatus(row: ConnectionRow, tx: Transaction): Promise<AgentConnectionStatus> {
  let status: AgentConnectionStatus['status'] = row.status;
  if (row.expires_at.getTime() <= Date.now()) status = 'expired';
  let grant: AgentConnectionStatus['grant'] = null;
  if (status === 'approved') {
    const [stored] =
      await tx`select id,label,scope,expires_at,revoked from host.grants where id=${row.grant_id}`;
    if (!stored || stored.revoked) status = 'cancelled';
    else if (stored.expires_at.getTime() <= Date.now()) status = 'expired';
    else
      grant = {
        id: stored.id,
        label: stored.label,
        ...agentScopeSchema.parse(stored.scope),
        expiresAt: stored.expires_at.toISOString(),
      };
  }
  return agentConnectionStatusSchema.parse({
    id: row.id,
    label: row.label,
    code: row.code,
    expiresAt: row.expires_at.toISOString(),
    status,
    grant,
  });
}

export async function inspectConnection(body: unknown) {
  const { id } = agentConnectionIdSchema.parse(body);
  return transaction(async (tx) => {
    const [row] = await tx<ConnectionRow[]>`select * from agent_bridge.connections where id=${id}`;
    assert(
      row,
      'connection_missing',
      'This connection request is unavailable. Run pnpm agent connect again.',
      404,
    );
    return publicStatus(row, tx);
  });
}

export async function approveConnection(body: unknown) {
  const input = agentConnectionApprovalSchema.parse(body);
  return transaction(async (tx) => {
    const [row] = await tx<
      ConnectionRow[]
    >`select * from agent_bridge.connections where id=${input.id} for update`;
    assert(
      row && row.expires_at.getTime() > Date.now(),
      'connection_expired',
      'This request expired. Run pnpm agent connect again.',
      410,
    );
    assert(row.code === input.code, 'code_mismatch', 'The connection code does not match.', 409);
    if (row.status === 'approved') {
      assert(
        canonical(row.approval) === canonical(input),
        'connection_conflict',
        'This connection was already approved with different access.',
        409,
      );
      return publicStatus(row, tx);
    }
    assert(
      row.status === 'pending',
      'connection_unavailable',
      'This connection request is no longer pending.',
      409,
    );
    const scope = agentScopeSchema.parse(input),
      id = randomUUID();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3600000).toISOString();
    await tx`insert into host.grants(id,token_hash,label,scope,expires_at) values(${id},${row.token_hash},${input.label},${tx.json(scope)},${expiresAt})`;
    await tx`update agent_bridge.connections set status='approved',grant_id=${id},approval=${tx.json(input)} where id=${row.id}`;
    return publicStatus({ ...row, status: 'approved', grant_id: id }, tx);
  });
}

export async function denyConnection(body: unknown) {
  const { id } = agentConnectionIdSchema.parse(body);
  return transaction(async (tx) => {
    const [row] = await tx<
      ConnectionRow[]
    >`select * from agent_bridge.connections where id=${id} for update`;
    assert(row, 'connection_missing', 'This connection request is unavailable.', 404);
    assert(
      row.status === 'pending' || row.status === 'denied',
      'connection_unavailable',
      'This connection request is no longer pending.',
      409,
    );
    await tx`update agent_bridge.connections set status='denied' where id=${id}`;
    return publicStatus({ ...row, status: 'denied' }, tx);
  });
}

export async function pollConnection(token: string) {
  // Polling does not acquire the domain write lock. A concurrent approval is observed on the next poll.
  const sql = connection();
  return sql.begin(async (tx) => {
    const [row] = await tx<
      ConnectionRow[]
    >`select * from agent_bridge.connections where token_hash=${digest(token)} for update`;
    assert(
      row,
      'connection_missing',
      'This connection request is unavailable. Run pnpm agent connect again.',
      401,
    );
    const [allowed] =
      await tx`update agent_bridge.connections set last_polled_at=now() where id=${row.id} and (last_polled_at is null or last_polled_at < now() - interval '1 second') returning id`;
    // Return a status instead of throwing so the last poll timestamp commits.
    if (!allowed) return { status: 'slow_down' as const };
    return publicStatus(row, tx);
  });
}

export async function cancelConnection(token: string) {
  const [candidate] =
    await connection()`select id from agent_bridge.connections where token_hash=${digest(token)}`;
  if (!candidate) return { ok: true };
  return transaction(async (tx) => {
    const [row] = await tx<
      ConnectionRow[]
    >`select * from agent_bridge.connections where token_hash=${digest(token)} for update`;
    if (row && row.id === candidate.id && (row.status === 'pending' || row.status === 'approved')) {
      if (row.grant_id) await tx`update host.grants set revoked=true where id=${row.grant_id}`;
      await tx`update agent_bridge.connections set status='cancelled' where id=${row.id}`;
    }
    return { ok: true };
  });
}
