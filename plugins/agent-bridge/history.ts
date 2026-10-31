import { z } from 'zod';
import { canonical, decrypt, encrypt, digest } from '../../packages/host/src/crypto';
import { connection, transaction, type Transaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import {
  historicalRecords,
  historyVersions,
  historicalProfile,
  recordsHistoryAvailability,
} from '../../instance/history-services';
import { grantForToken } from './service';
import {
  grantScopeSchema,
  historicalScope,
  historyQuerySchema,
  historyResponseSchema,
  HISTORY_PAGE_BYTES,
  type HistoryQuery,
  type HistoryRecord,
  type HistoryScope,
  type HistoryResponse,
  type HistorySelection,
  healthMetricSchema,
} from '@athlete-panel/contracts';
import { historySummaryAccumulator, summaryKey } from './history-summary';
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
const permissions: Record<string, HistoryScope['categories'][number]> = {
  activities: 'activities',
  health: 'health',
  workouts: 'training',
  plans: 'training',
  notes: 'training',
  events: 'context',
  injuries: 'context',
};
function categories(scope: HistoryScope) {
  return Object.keys(permissions).filter(
    (k) => scope.categories.includes(permissions[k]!) && (k !== 'notes' || scope.includeNotes),
  ) as NonNullable<HistoryQuery['category']>[];
}
function sanitize(r: HistoryRecord, scope: HistoryScope) {
  const data = { ...r.data },
    within = (d: string | null | undefined) => Boolean(d && d >= scope.from && d <= scope.to);
  if (!scope.includeNotes) {
    for (const field of ['notes', 'body', 'reason', 'completionNotes'])
      delete data[field as keyof typeof data];
    if (r.category === 'plans') delete data.description;
    if (data.part) {
      const redact = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(redact)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v)
                  .filter(([k]) => k !== 'notes' && k !== 'instructions')
                  .map(([k, x]) => [k, redact(x)]),
              )
            : v;
      data.part = redact(data.part) as Record<string, unknown>;
    }
  }
  if (r.category === 'workouts') {
    if (!within(data.scheduledDate)) {
      delete data.scheduledDate;
      delete data.durationSeconds;
      delete data.distanceMeters;
      delete data.elevationMeters;
    }
    const completionOutsideScope = Boolean(data.completionStatus && !within(data.performedDate));
    if (!within(data.performedDate))
      for (const field of [
        'performedDate',
        'completionStatus',
        'completionSource',
        'activityId',
        'actualDurationSeconds',
        'actualDistanceMeters',
        'rpe',
        'reason',
        'completionNotes',
      ])
        delete data[field as keyof typeof data];
    if (completionOutsideScope) data.completionStatus = 'unknown';
    if (data.completionSource === 'garmin' && !scope.categories.includes('activities'))
      for (const field of ['activityId', 'actualDurationSeconds', 'actualDistanceMeters'])
        delete data[field as keyof typeof data];
  }
  return { ...r, data };
}
async function* scan(tx: Transaction, q: HistorySelection, scope: HistoryScope) {
  let after = q.after;
  for (;;) {
    const rows = await historicalRecords(tx, { ...q, after }, scope);
    for (const row of rows) yield sanitize(row, scope);
    const last = rows.at(-1);
    if (rows.length < q.take || !last) return;
    after = { date: last.date, id: last.id };
  }
}
export async function readHistory(
  token: string,
  operation: HistoryResponse['operation'],
  body: unknown = {},
) {
  const candidate = await grantForToken(token, connection());
  const input = historyQuerySchema.parse(body);
  return transaction(async (tx) => {
    const grant = await grantForToken(token, tx);
    assert(grant.id === candidate.id, 'invalid_grant', 'This connection is unavailable.', 401);
    const scope = historicalScope(grantScopeSchema.parse(grant.scope));
    assert(
      scope,
      'forbidden',
      'This connection has no historical access. Approve historical review in your browser.',
      403,
    );
    const q = { ...input, from: input.from ?? scope.from, to: input.to ?? scope.to };
    assert(
      q.from >= scope.from && q.to <= scope.to && q.from <= q.to,
      'out_of_scope',
      `Choose dates from ${scope.from} through ${scope.to}, inclusive.`,
      403,
    );
    const permitted = categories(scope);
    if (operation === 'discover' || operation === 'context')
      assert(
        !q.category &&
          !q.sport &&
          !q.subgroup &&
          !q.metric &&
          !q.recordId &&
          q.section === 'core' &&
          !q.cursor,
        'validation',
        'Discovery and profile context accept dates and a review token; use records or summary for category filters and pages.',
        400,
      );
    if (q.category)
      assert(
        q.category === 'coverage'
          ? scope.categories.some((c) => c === 'activities' || c === 'health')
          : permitted.includes(q.category),
        'forbidden',
        'This historical category is not included in the grant.',
        403,
      );
    assert(
      !(q.sport || q.subgroup) ||
        (operation === 'summary' && !q.category) ||
        q.category === 'activities' ||
        q.category === 'workouts',
      'validation',
      'Sport filters apply to activities and workouts.',
      400,
    );
    assert(
      !q.metric || q.category === 'health',
      'validation',
      'Use category health with a metric filter.',
      400,
    );
    assert(
      q.section === 'core' || (operation === 'records' && q.category === 'workouts' && q.recordId),
      'validation',
      'Prescription sections require category workouts and a recordId.',
      400,
    );
    if (operation === 'summary' && q.category)
      assert(
        ['activities', 'health', 'workouts', 'coverage'].includes(q.category),
        'validation',
        'Summaries support activities, health, workouts and coverage; use records for other categories.',
        400,
      );
    if (operation === 'context')
      assert(
        scope.categories.includes('context'),
        'forbidden',
        'Profile/context access was not approved.',
        403,
      );
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
    const response: HistoryResponse = {
      version: 1,
      operation,
      scope,
      reviewToken,
      expiresAt: review.expiresAt,
      asOf: review.asOf,
      query,
      nextCursor: null,
      warnings: [
        'Missing records or measurements do not establish inactivity. Scan coverage is separate from measurement availability.',
        'Changes anywhere in a participating collection can require restarting this review.',
      ],
    };
    if (!scope.categories.includes('training'))
      response.warnings.push(
        'Planned-versus-recorded comparison is unavailable: training access is excluded. Actual totals include permitted activities only.',
      );
    if (!scope.categories.includes('activities'))
      response.warnings.push(
        'Recorded activity comparison is unavailable: activities access is excluded. Actual totals include eligible manual completions only; linked activity snapshots are excluded.',
      );
    const selection = { ...q, take: 1000, facts: true };
    if (operation === 'discover') {
      response.categories = scope.categories;
      response.availability = [];
      response.supportedFilters = {
        sportCategories: permitted.filter((c) => c === 'activities' || c === 'workouts'),
        healthMetrics: scope.categories.includes('health') ? healthMetricSchema.options : [],
        periods: ['month', 'week'],
        prescriptionSections: scope.categories.includes('training') ? ['steps', 'exercises'] : [],
      };
      for (const category of [
        ...permitted,
        ...(scope.categories.some((c) => c === 'activities' || c === 'health')
          ? ['coverage' as const]
          : []),
      ]) {
        if (category === 'activities' || category === 'health') {
          const available = await recordsHistoryAvailability(tx, { ...selection, category });
          response.availability.push({
            category,
            count: Number(available.count),
            from: available.from as string | null,
            to: available.to as string | null,
          });
          continue;
        }
        let count = 0,
          from: string | null = null,
          to: string | null = null;
        for await (const row of scan(tx, { ...selection, category }, scope)) {
          count++;
          from ??= row.date;
          to = row.date;
        }
        response.availability.push({ category, count, from, to });
      }
    } else if (operation === 'context') {
      response.profile = await historicalProfile(tx);
      response.profileMeaning = 'Current profile; not historical settings.';
      response.warnings.push(
        'Retrieve dated events and injuries with history records. Profile settings are current, not historical.',
      );
    } else if (operation === 'records') {
      assert(q.category, 'validation', 'Choose a category from history discover.', 400);
      const rows = await historicalRecords(
        tx,
        { ...q, take: q.limit + 1, after: cursor?.after, facts: false },
        scope,
      );
      response.records = [];
      for (const raw of rows) {
        const row = sanitize(raw, scope);
        if (
          response.records.length === q.limit ||
          Buffer.byteLength(JSON.stringify({ ...response, records: [...response.records, row] })) >
            HISTORY_PAGE_BYTES - 20000
        ) {
          const last = response.records.at(-1);
          assert(
            last,
            'record_too_large',
            'This record exceeds the response budget; request its prescription sections separately.',
            413,
          );
          response.nextCursor = encrypt(
            canonical({
              purpose: 'history-page-v1',
              reviewHash: digest(reviewToken),
              queryHash,
              after: { date: last.date, id: last.id },
            }),
          );
          break;
        }
        response.records.push(row);
      }
    } else {
      const aggregate = historySummaryAccumulator(scope, q);
      const kinds = q.category
        ? [q.category]
        : permitted.filter((c) => ['activities', 'health', 'workouts'].includes(c));
      if (!q.category && scope.categories.some((c) => c === 'activities' || c === 'health'))
        kinds.push('coverage');
      for (const category of kinds)
        for await (const row of scan(
          tx,
          {
            ...selection,
            category,
            sport: ['activities', 'workouts'].includes(category) ? q.sport : undefined,
            subgroup: ['activities', 'workouts'].includes(category) ? q.subgroup : undefined,
          },
          scope,
        ))
          aggregate.ingest(row);
      const rows = aggregate.finish().filter((row) => !cursor?.key || summaryKey(row) > cursor.key);
      response.summaries = [];
      for (const row of rows) {
        if (
          response.summaries.length === q.limit ||
          Buffer.byteLength(
            JSON.stringify({ ...response, summaries: [...response.summaries, row] }),
          ) >
            HISTORY_PAGE_BYTES - 20000
        ) {
          const last = response.summaries.at(-1);
          assert(
            last,
            'summary_too_large',
            'This summary exceeds the response budget. Retrieve the period as detailed records.',
            413,
          );
          response.nextCursor = encrypt(
            canonical({
              purpose: 'history-page-v1',
              reviewHash: digest(reviewToken),
              queryHash,
              key: summaryKey(last),
            }),
          );
          break;
        }
        response.summaries.push(row);
      }
    }
    assert(
      canonical(await historyVersions(tx, scope)) === canonical(versions),
      'history_changed',
      'History changed during this request. Discard the review and restart with history discover.',
      409,
    );
    await grantForToken(token, tx); // clock_timestamp catches expiry while a long overview was executing.
    assert(
      Buffer.byteLength(JSON.stringify(response)) <= HISTORY_PAGE_BYTES,
      'response_too_large',
      'Narrow the requested history selection.',
      413,
    );
    return historyResponseSchema.parse(response);
  });
}
