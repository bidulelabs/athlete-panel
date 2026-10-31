import { z } from 'zod';
import { agentScopeSchema, planningScopeSchema, workspaceStateSchema } from './domain';
import { entityChangeSchema } from './responses';

export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const proposalExpiresAt = (createdAt: Date | string) =>
  new Date(new Date(createdAt).getTime() + PROPOSAL_LIFETIME_MS).toISOString();
const legacyContext = z.object({ scope: agentScopeSchema, digest: z.string().length(64) }).strict();
export const proposalContextSchema = z.union([
  z
    .object({
      version: z.literal(3),
      scope: planningScopeSchema,
      digest: z.string().length(64),
      snapshot: workspaceStateSchema,
    })
    .strict(),
  legacyContext.extend({ version: z.literal(2), snapshot: workspaceStateSchema }).strict(),
  legacyContext,
]);
export const proposalReviewInputSchema = z
  .object({ id: z.uuid(), digest: z.string().length(64) })
  .strict();
export const proposalApplyInputSchema = proposalReviewInputSchema
  .extend({
    idempotencyKey: z.uuid(),
    reviewedContextDigest: z.string().length(64).optional(),
  })
  .strict();
export const proposalReviewSchema = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  applicability: z.enum([
    'ready',
    'review-required',
    'conflict',
    'expired',
    'revoked',
    'unavailable',
    'replacement-required',
  ]),
  currentContextDigest: z.string().length(64).nullable(),
  contextChanges: z.array(entityChangeSchema),
  conflicts: z.array(z.object({ code: z.string(), message: z.string(), status: z.number().int() })),
});
export type ProposalReview = z.infer<typeof proposalReviewSchema>;
