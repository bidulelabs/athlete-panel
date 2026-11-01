import type {
  HistoryQuery,
  HistoryScope,
  HistoryResponse,
  HistorySelection,
} from '@athlete-panel/contracts';
import { assert } from '../../packages/host/src/errors';
import { historicalCategories } from './history-policy';
export type ResolvedHistoryQuery = HistoryQuery & { from: string; to: string };
export function historyReadSelection(
  q: ResolvedHistoryQuery,
  page: Pick<HistorySelection, 'take' | 'facts' | 'after'>,
): HistorySelection {
  return {
    from: q.from,
    to: q.to,
    category: q.category,
    sport: q.sport,
    subgroup: q.subgroup,
    metric: q.metric,
    recordId: q.recordId,
    section: q.section,
    ...page,
  };
}
export function resolveHistoryQuery(
  input: HistoryQuery,
  scope: HistoryScope,
  operation: HistoryResponse['operation'],
): ResolvedHistoryQuery {
  const q = { ...input, from: input.from ?? scope.from, to: input.to ?? scope.to };
  assert(
    q.from >= scope.from && q.to <= scope.to && q.from <= q.to,
    'out_of_scope',
    `Choose dates from ${scope.from} through ${scope.to}, inclusive.`,
    403,
  );
  const permitted = historicalCategories(scope);
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
  return q;
}
