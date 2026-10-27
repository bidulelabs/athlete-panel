import { persistAndAudit } from '../../instance/commit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  commandsSchema,
  agentScopeSchema,
  agentGrantValuesSchema,
  type Command,
  proposalApplyInputSchema,
} from '../../packages/contracts/src';
import { connection, transaction, type Transaction } from '../../packages/host/src/db';
import { canonical, digest, randomToken } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import { loadWorkspace } from '../../instance/services';
import { applyCommands } from '../training/public/server';
import { idempotent, undoChange } from '../training/public/server';

import {
  boundedContext,
  hasStepNotes,
  assertReadableSources,
  assertBounded,
} from './proposal-validation';
import { evaluateProposal, reviewProposal } from './proposal-review';
const scopeSchema = agentScopeSchema;

export async function createGrant(body: unknown) {
  const input = agentGrantValuesSchema.parse(body);
  const scope = scopeSchema.parse(input);
  const id = randomUUID(),
    token = randomToken();
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3600000).toISOString();
  await transaction(async (tx) => {
    await tx`insert into host.grants(id,token_hash,label,scope,expires_at) values(${id},${digest(token)},${input.label},${tx.json(scope)},${expiresAt})`;
  });
  return { grant: { id, label: input.label, ...scope, expiresAt, revoked: false }, token };
}
export async function revokeGrant(body: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(body);
  await transaction(async (tx) => {
    await tx`update host.grants set revoked=true where id=${id}`;
  });
  return { ok: true };
}
async function grantForToken(token: string, tx: Transaction | ReturnType<typeof connection>) {
  const [grant] =
    await tx`select * from host.grants where token_hash=${digest(token)} and revoked=false and expires_at>now()`;
  assert(grant, 'invalid_grant', 'This agent grant is expired or revoked.', 401);
  return grant;
}
export async function contextForToken(token: string) {
  const candidate = await grantForToken(token, connection());
  return transaction(async (tx) => {
    const grant = await grantForToken(token, tx),
      scope = scopeSchema.parse(grant.scope);
    assert(
      grant.id === candidate.id,
      'invalid_grant',
      'This agent grant is expired or revoked.',
      401,
    );
    const context = boundedContext(await loadWorkspace(tx, scope), scope);
    return {
      version: 1,
      scope,
      context,
      contextDigest: digest(canonical(context)),
      expiresAt: grant.expires_at,
    };
  });
}
function assignIds(commands: Command[]): Command[] {
  return commands.map((c) =>
    c.action.endsWith('.create') || c.action.endsWith('.duplicate')
      ? ({
          ...c,
          values: {
            ...('values' in c ? c.values : {}),
            id: ('values' in c && 'id' in c.values && c.values.id) || randomUUID(),
          },
        } as Command)
      : c,
  );
}
export async function submitProposal(token: string, body: unknown) {
  const candidate = await grantForToken(token, connection());
  const input = z
    .object({
      commands: commandsSchema,
      summary: z.string().min(1).max(500),
      contextDigest: z.string().length(64),
      idempotencyKey: z.uuid(),
    })
    .strict()
    .parse(body);
  return transaction(async (tx) => {
    const grant = await grantForToken(token, tx),
      scope = scopeSchema.parse(grant.scope);
    assert(
      grant.id === candidate.id,
      'invalid_grant',
      'This agent grant is expired or revoked.',
      401,
    );
    return idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'propose', grantId: grant.id, ...input },
      async () => {
        const before = await loadWorkspace(tx, scope),
          context = boundedContext(before, scope);
        assert(
          digest(canonical(context)) === input.contextDigest,
          'stale_context',
          'Training context changed. Read it again and review your proposal.',
          409,
        );
        const commands = assignIds(input.commands);
        assertReadableSources(commands, before, scope);
        const result = applyCommands(before, commands, { actor: 'agent' });
        if (!scope.includeNotes)
          for (const command of commands) {
            assert(
              !(
                'values' in command &&
                'notes' in command.values &&
                (command.action.endsWith('.update') || command.values.notes !== '')
              ),
              'forbidden',
              'This grant does not allow reading or editing notes.',
              403,
            );
            if (command.action === 'plan.update')
              assert(
                !('description' in command.values),
                'forbidden',
                'Editing plan notes requires notes access.',
                403,
              );
            if (command.action === 'plan.create')
              assert(
                !command.values.description,
                'forbidden',
                'Creating plan notes requires notes access.',
                403,
              );
            if (
              (command.action === 'workout.create' || command.action === 'workout.update') &&
              command.values.steps
            ) {
              const source =
                command.action === 'workout.update'
                  ? before.workouts.find((w) => w.id === command.id)
                  : undefined;
              assert(
                !hasStepNotes(command.values.steps) && (!source || !hasStepNotes(source.steps)),
                'forbidden',
                'Editing intervals with private notes requires notes access.',
                403,
              );
            }
          }
        assertBounded(result.changes, before, result.state, scope);
        const id = randomUUID();
        const proposalDigest = digest(
          canonical({
            commands,
            changes: result.changes,
            contextDigest: input.contextDigest,
            summary: input.summary,
          }),
        );
        await tx`insert into host.proposals(id,grant_id,status,summary,commands,changes,context,digest) values(${id},${grant.id},'pending',${input.summary},${tx.json(commands as never)},${tx.json(result.changes as never)},${tx.json({ version: 2, scope, digest: input.contextDigest, snapshot: context } as never)},${proposalDigest})`;
        return {
          id,
          digest: proposalDigest,
          status: 'pending',
          affected: result.changes.map((c) => ({ entity: c.entity, id: c.id })),
        };
      },
    );
  });
}
export async function applyProposal(body: unknown) {
  const input = proposalApplyInputSchema.parse(body);
  return transaction((tx) =>
    idempotent(tx, input.idempotencyKey, { operation: 'apply', ...input }, async () => {
      const { proposal, result, review } = await evaluateProposal(tx, input);
      const conflict = review.conflicts[0];
      assert(
        !conflict,
        conflict?.code ?? 'proposal_unavailable',
        conflict?.message ?? 'This proposal cannot be applied.',
        conflict?.status ?? 409,
      );
      assert(result, 'proposal_unavailable', 'This proposal cannot be applied.', 409);
      assert(
        input.reviewedContextDigest === undefined ||
          input.reviewedContextDigest === review.currentContextDigest,
        'stale_context',
        'Context changed again. Review the latest context before applying.',
        409,
      );
      assert(
        review.applicability !== 'review-required' ||
          input.reviewedContextDigest === review.currentContextDigest,
        'stale_context',
        'Context changed. Review the latest context before applying.',
        409,
      );
      const id = await persistAndAudit(tx, result.changes, proposal.summary, 'agent');
      const output = { id, proposalId: proposal.id, changes: result.changes };
      await tx`update host.proposals set status='applied',result=${tx.json(output as never)} where id=${proposal.id}`;
      return output;
    }),
  );
}
export async function rejectProposal(body: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(body);
  await transaction(async (tx) => {
    await tx`update host.proposals set status='rejected' where id=${id} and status='pending'`;
  });
  return { ok: true };
}
export { undoChange, reviewProposal };
