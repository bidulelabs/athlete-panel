import {
  grantScopeSchema,
  planningScope,
  agentCommandsSchema,
  entityChangeSchema,
  proposalContextSchema,
  proposalReviewInputSchema,
  proposalReviewSchema,
  proposalExpiresAt,
  type Entity,
  type EntityChange,
  type WorkspaceState,
  type ProposalReview,
} from '../../packages/contracts/src';
import { transaction, type Transaction } from '../../packages/host/src/db';
import { canonical, digest } from '../../packages/host/src/crypto';
import { assert, AppError } from '../../packages/host/src/errors';
import { loadWorkspace } from '../../instance/services';
import { applyCommands, DomainError } from '../training/public/server';
import { boundedContext, assertReadableSources, assertBounded } from './proposal-validation';

type ProposalRow = {
  id: string;
  status: string;
  summary: string;
  digest: string;
  created_at: Date;
  commands: unknown;
  changes: unknown;
  context: unknown;
  revoked: boolean;
  scope: unknown;
};
function contextChanges(
  before: WorkspaceState,
  after: WorkspaceState,
): ProposalReview['contextChanges'] {
  const changes: ProposalReview['contextChanges'] = [];
  const compare = (entity: EntityChange['entity'], previous: Entity[], current: Entity[]) => {
    const old = new Map(previous.map((record) => [record.id, record]));
    const next = new Map(current.map((record) => [record.id, record]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id) ?? null,
        b = next.get(id) ?? null;
      if (canonical(a) !== canonical(b))
        changes.push(entityChangeSchema.parse({ entity, id, before: a, after: b }));
    }
  };
  compare('profile', before.profile ? [before.profile] : [], after.profile ? [after.profile] : []);
  for (const [key, entity] of [
    ['plans', 'plan'],
    ['workouts', 'workout'],
    ['notes', 'note'],
    ['events', 'event'],
    ['injuries', 'injury'],
    ['activities', 'activity'],
    ['health', 'health'],
  ] as const)
    compare(entity, before[key], after[key]);
  return changes;
}

/** Both owner review and application evaluate the same immutable proposal under the domain lock. */
export async function evaluateProposal(tx: Transaction, input: { id: string; digest: string }) {
  const [proposal] = await tx<
    ProposalRow[]
  >`select p.id,p.status,p.summary,p.digest,p.created_at,p.commands,p.changes,p.context,g.revoked,g.scope from host.proposals p join host.grants g on p.grant_id=g.id where p.id=${input.id} for update`;
  assert(proposal, 'proposal_unavailable', 'This proposal is missing.', 404);
  assert(
    proposal.digest === input.digest,
    'digest_mismatch',
    'The reviewed proposal does not match this request.',
    409,
  );
  const review: ProposalReview = {
    id: proposal.id,
    expiresAt: proposalExpiresAt(proposal.created_at),
    applicability: 'ready',
    currentContextDigest: null,
    contextChanges: [],
    conflicts: [],
  };
  let result: ReturnType<typeof applyCommands> | undefined;
  const blocked = (
    state: ProposalReview['applicability'],
    code: string,
    message: string,
    status = 409,
  ) => {
    review.applicability = state;
    review.conflicts.push({ code, message, status });
    return { proposal, result, review };
  };
  if (proposal.status !== 'pending')
    return blocked('unavailable', 'proposal_unavailable', 'This proposal is no longer pending.');
  if (proposal.revoked)
    return blocked('revoked', 'invalid_grant', 'The proposal grant has been revoked.', 403);
  if (Date.parse(review.expiresAt) <= Date.now())
    return blocked(
      'expired',
      'proposal_expired',
      'This proposal expired after seven days. Request a replacement.',
    );
  const context = proposalContextSchema.parse(proposal.context);
  const commands = agentCommandsSchema.parse(proposal.commands);
  const changes = entityChangeSchema.array().parse(proposal.changes);
  assert(
    canonical(context.scope) === canonical(planningScope(grantScopeSchema.parse(proposal.scope))),
    'out_of_scope',
    'The stored proposal scope no longer matches its grant.',
    403,
  );
  assert(
    digest(
      canonical({ commands, changes, contextDigest: context.digest, summary: proposal.summary }),
    ) === proposal.digest,
    'digest_mismatch',
    'The stored proposal no longer matches its immutable digest.',
    409,
  );
  const before = await loadWorkspace(tx, context.scope);
  const current = boundedContext(before, context.scope);
  review.currentContextDigest = digest(canonical(current));
  const changed = review.currentContextDigest !== context.digest;
  if ('snapshot' in context) {
    assert(
      digest(canonical(context.snapshot)) === context.digest,
      'digest_mismatch',
      'The saved context no longer matches its digest.',
      409,
    );
    review.contextChanges = contextChanges(context.snapshot, current);
  }
  try {
    assertReadableSources(commands, before, context.scope);
    result = applyCommands(before, commands, { actor: 'agent' });
    assertBounded(result.changes, before, result.state, context.scope);
    assert(
      canonical(result.changes) === canonical(changes),
      'proposal_changed',
      'The resulting edits differ from the proposed changes.',
      409,
    );
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof DomainError)) throw error;
    result = undefined;
    return blocked(
      'conflict',
      error.code,
      `${error.message} Request a replacement proposal.`,
      error.status,
    );
  }
  if (changed && !('snapshot' in context))
    return blocked(
      'replacement-required',
      'legacy_context_changed',
      'Context changed, but this older proposal has no saved context to compare. Request a replacement.',
    );
  review.applicability = changed ? 'review-required' : 'ready';
  return { proposal, result, review };
}

export async function reviewProposal(body: unknown): Promise<ProposalReview> {
  const input = proposalReviewInputSchema.parse(body);
  return transaction(async (tx) =>
    proposalReviewSchema.parse((await evaluateProposal(tx, input)).review),
  );
}
