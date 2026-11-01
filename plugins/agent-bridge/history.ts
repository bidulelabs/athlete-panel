import { connection, readTransaction, type Transaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import {
  historicalRecords,
  historicalProfile,
  historicalAvailability,
} from '../../instance/history-services';
import { grantForToken } from './service';
import {
  historyQuerySchema,
  historyResponseSchema,
  HISTORY_PAGE_BYTES,
  healthMetricSchema,
  type HistoryScope,
  type HistoryResponse,
  type HistorySelection,
  type HistorySummary,
} from '@athlete-panel/contracts';
import { historySummaryAccumulator, summaryKey } from './history-summary';
import { historicalCategories, sanitizeHistoryRecord } from './history-policy';
import {
  openHistorySession,
  validateHistorySession,
  historyCursor,
  historySummaryCacheKey,
} from './history-session';
import { boundedHistoryPage } from './history-paging';
import { historySummaryCache } from './history-summary-cache';
import { historyReadSelection } from './history-query';
async function* scan(tx: Transaction, q: HistorySelection, scope: HistoryScope) {
  let after = q.after;
  for (;;) {
    const rows = await historicalRecords(tx, { ...q, after }, scope);
    for (const row of rows) yield sanitizeHistoryRecord(row, scope);
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
  return readTransaction(async (tx) => {
    const session = await openHistorySession(tx, token, candidate.id, operation, input);
    const { scope, q, review, reviewToken, query, cursor } = session;
    const permitted = historicalCategories(scope);
    let computed: HistorySummary[] | undefined;
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
    const selection = historyReadSelection(q, { take: 1000, facts: true });
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
        response.availability.push(
          await historicalAvailability(tx, { category, from: q.from, to: q.to }, scope),
        );
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
        { ...selection, take: q.limit + 1, after: cursor?.after, facts: false },
        scope,
      );
      const page = boundedHistoryPage(
        rows.map((row) => sanitizeHistoryRecord(row, scope)),
        response,
        q.limit,
        (last) => historyCursor(session, { after: { date: last.date, id: last.id } }),
        {
          code: 'record_too_large',
          message:
            'This record exceeds the response budget; request its prescription sections separately.',
        },
      );
      response.records = page.items;
      response.nextCursor = page.nextCursor;
    } else {
      let summaries = historySummaryCache.get(historySummaryCacheKey(session));
      if (!summaries) {
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

        summaries = aggregate.finish();
        computed = summaries;
      }
      // Cached aggregates are token-free. Bind every emitted reference to this review
      // before sizing the page, without mutating results reused by another review.
      const rows = summaries
        .filter((row) => !cursor?.key || summaryKey(row) > cursor.key)
        .map((row) => ({
          ...row,
          reference: { ...row.reference, reviewToken },
          detailReferences: row.detailReferences?.map((reference) => ({
            ...reference,
            reviewToken,
          })),
        }));
      const page = boundedHistoryPage(
        rows,
        response,
        q.limit,
        (last) => historyCursor(session, { key: summaryKey(last) }),
        {
          code: 'summary_too_large',
          message:
            'This summary exceeds the response budget. Retrieve the period as detailed records.',
        },
      );
      response.summaries = page.items;
      response.nextCursor = page.nextCursor;
    }
    // READ COMMITTED makes these fresh checks see edits/revocations committed while queries ran.
    await validateHistorySession(tx, token, session);
    assert(
      Buffer.byteLength(JSON.stringify(response)) <= HISTORY_PAGE_BYTES,
      'response_too_large',
      'Narrow the requested history selection.',
      413,
    );
    const checked = historyResponseSchema.parse(response);
    if (computed)
      historySummaryCache.put(
        historySummaryCacheKey(session),
        computed,
        Date.parse(review.expiresAt),
      );
    return checked;
  });
}
