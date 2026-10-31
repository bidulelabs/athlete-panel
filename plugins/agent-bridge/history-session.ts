import { z } from 'zod';
import { canonical, decrypt, encrypt, digest } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import type { Transaction } from '../../packages/host/src/db';
import { historyVersions } from '../../instance/history-services';
import {
  grantScopeSchema,
  historicalScope,
  type HistoryQuery,
  type HistoryResponse,
} from '@athlete-panel/contracts';
import { grantForToken } from './service';
import { resolveHistoryQuery } from './history-query';
const reviewSchema = z
  .object({
    purpose: z.literal('history-review-v1'),
    grantId: z.string(),
    scopeHash: z.string(),
    versions: z.record(z.string(), z.string()),
    asOf: z.string(),
    expiresAt: z.string(),
  })
  .strict();
const cursorSchema = z
  .object({
    purpose: z.literal('history-page-v1'),
    reviewHash: z.string(),
    queryHash: z.string(),
    after: z.object({ date: z.string(), id: z.string() }).optional(),
    key: z.string().optional(),
  })
  .strict();
function decode<T>(value: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(decrypt(value)));
  } catch {
    throw new Error('Invalid historical cursor or review token. Restart with history discover.');
  }
}

export async function openHistorySession(
  tx: Transaction,
  token: string,
  candidateId: string,
  operation: HistoryResponse['operation'],
  input: HistoryQuery,
) {
  const grant = await grantForToken(token, tx);
  assert(grant.id === candidateId, 'invalid_grant', 'This connection is unavailable.', 401);
  const scope = historicalScope(grantScopeSchema.parse(grant.scope));
  assert(
    scope,
    'forbidden',
    'This connection has no historical access. Approve historical review in your browser.',
    403,
  );
  const q = resolveHistoryQuery(input, scope, operation);
  const versions = await historyVersions(tx, scope),
    scopeHash = digest(canonical(scope));
  let review: z.infer<typeof reviewSchema>;
  try {
    review = input.reviewToken
      ? decode(input.reviewToken, reviewSchema)
      : {
          purpose: 'history-review-v1',
          grantId: grant.id,
          scopeHash,
          versions,
          asOf: new Date().toISOString(),
          expiresAt: grant.expires_at.toISOString(),
        };
  } catch {
    assert(false, 'invalid_cursor', 'Invalid review token. Restart with history discover.', 400);
  }
  assert(
    review.grantId === grant.id && review.scopeHash === scopeHash,
    'invalid_cursor',
    'This review belongs to different approved access.',
    403,
  );
  assert(
    canonical(review.versions) === canonical(versions),
    'history_changed',
    'History changed. Discard this review and its pages, then restart with history discover.',
    409,
  );
  const reviewToken = input.reviewToken ?? encrypt(canonical(review));
  const query = { ...q, reviewToken: undefined, cursor: undefined };
  const queryHash = digest(canonical({ operation, ...query }));
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (input.cursor) {
    try {
      cursor = decode(input.cursor, cursorSchema);
    } catch {
      assert(false, 'invalid_cursor', 'Invalid cursor. Restart with history discover.', 400);
    }
    assert(
      input.reviewToken &&
        cursor.reviewHash === digest(reviewToken) &&
        cursor.queryHash === queryHash,
      'invalid_cursor',
      'Cursor does not match this review, operation, filters or page size.',
      400,
    );
  }
  return {
    scope,
    q,
    versions,
    review,
    reviewToken,
    query,
    queryHash,
    cursor,
    grantId: String(grant.id),
    scopeHash,
  };
}
export type HistorySession = Awaited<ReturnType<typeof openHistorySession>>;
export async function validateHistorySession(
  tx: Transaction,
  token: string,
  session: HistorySession,
) {
  assert(
    canonical(await historyVersions(tx, session.scope)) === canonical(session.versions),
    'history_changed',
    'History changed during this request. Discard the review and restart with history discover.',
    409,
  );
  await grantForToken(token, tx);
}
export function historyCursor(
  session: HistorySession,
  position: { after: { date: string; id: string } } | { key: string },
) {
  return encrypt(
    canonical({
      purpose: 'history-page-v1',
      reviewHash: digest(session.reviewToken),
      queryHash: session.queryHash,
      ...position,
    }),
  );
}
export function historySummaryCacheKey(session: HistorySession) {
  return digest(
    canonical({
      grantId: session.grantId,
      scopeHash: session.scopeHash,
      versions: session.versions,
      queryHash: session.queryHash,
    }),
  );
}
