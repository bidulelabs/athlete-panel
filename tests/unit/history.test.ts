import { expect, it } from 'vitest';
import {
  agentScopeSchema,
  planningScopeSchema,
  historyScopeSchema,
  addCalendarYears,
  agentCommandsSchema,
  commandsSchema,
  type HistoryScope,
  type HistoryQuery,
} from '../../packages/contracts/src';
import {
  historyPeriods,
  historySummaryAccumulator,
} from '../../plugins/agent-bridge/history-summary';
const scope: HistoryScope = {
  from: '2024-01-01',
  to: '2024-01-31',
  includeNotes: false,
  categories: ['activities', 'health', 'training'],
  weekStartsOn: 1,
};
const q: HistoryQuery & { from: string; to: string } = {
  ...scope,
  period: 'month',
  limit: 100,
  section: 'core',
};
it('uses inclusive calendar anniversaries without widening legacy scopes', () => {
  expect(
    historyScopeSchema.safeParse({ ...scope, from: '2021-10-31', to: '2026-10-31' }).success,
  ).toBe(true);
  expect(
    historyScopeSchema.safeParse({ ...scope, from: '2021-10-31', to: '2026-11-01' }).success,
  ).toBe(false);
  expect(addCalendarYears('2024-02-29', 1)).toBe('2025-02-28');
  expect(planningScopeSchema.safeParse({ from: '2024-02-29', to: '2025-02-28' }).success).toBe(
    true,
  );
  expect(planningScopeSchema.safeParse({ from: '2024-02-29', to: '2025-03-01' }).success).toBe(
    false,
  );
  expect(planningScopeSchema.safeParse({ from: '2026-10-31', to: '2027-10-31' }).success).toBe(
    true,
  );
  expect(agentScopeSchema.safeParse({ from: '2026-10-31', to: '2027-10-31' }).success).toBe(false);
  expect(
    historyScopeSchema.safeParse({ ...scope, from: '2024-02-29', to: '2029-02-28' }).success,
  ).toBe(true);
});
it('clips month and chosen week boundaries, including leap days', () => {
  expect(historyPeriods('2024-02-28', '2024-03-02', 'month', 1)).toMatchObject([
    { from: '2024-02-28', to: '2024-02-29', calendarDays: 2, partial: true },
    { from: '2024-03-01', to: '2024-03-02', calendarDays: 2, partial: true },
  ]);
  expect(historyPeriods('2024-01-07', '2024-01-08', 'week', 0)).toHaveLength(1);
  expect(historyPeriods('2024-01-07', '2024-01-08', 'week', 1)).toHaveLength(2);
});
it('keeps known zero, corrections to unknown and source ambiguity distinct', () => {
  const aggregate = historySummaryAccumulator(scope, q);
  for (const [id, source, value, revision] of [
    ['a', 'a', 50, 1],
    ['b', 'a', null, 2],
    ['c', 'b', 60, 1],
  ] as const)
    aggregate.ingest({
      category: 'health',
      id,
      date: '2024-01-01',
      data: { source, value, revision, metric: 'hrvMilliseconds' },
    });
  aggregate.ingest({
    category: 'health',
    id: 'd',
    date: '2024-01-02',
    data: { source: 'a', value: 0, revision: 1, metric: 'hrvMilliseconds' },
  });
  const a = aggregate
    .finish()
    .find((r) => r.category === 'health' && r.source === 'a' && r.metric === 'hrvMilliseconds')!;
  expect(a).toMatchObject({
    mean: 0,
    contributingDays: 1,
    unknownDays: 1,
    missingDays: 30,
    count: 3,
  });
});
it('does not count a linked workout twice and uses actual dates', () => {
  const aggregate = historySummaryAccumulator(scope, q);
  aggregate.ingest({
    category: 'activities',
    id: 'a',
    date: '2024-01-02',
    data: { sport: 'running', durationSeconds: 100, distanceMeters: null, elevationMeters: 0 },
  });
  aggregate.ingest({
    category: 'workouts',
    id: 'b',
    date: '2024-01-01',
    data: {
      sport: 'running',
      scheduledDate: '2024-01-01',
      performedDate: '2024-01-02',
      completionStatus: 'completed',
      completionSource: 'garmin',
      durationSeconds: 200,
      actualDurationSeconds: 100,
    },
  });
  const rows = aggregate.finish();
  expect(rows.find((r) => r.category === 'actual')).toMatchObject({
    count: 1,
    durationSeconds: { value: 100, knownCount: 1 },
    distanceMeters: { value: null, missingCount: 1 },
  });
  expect(rows.find((r) => r.category === 'planned')).toMatchObject({
    count: 1,
    durationSeconds: { value: 200 },
  });
});
it('allows 1500 agent commands while manual commands remain capped at 200', () => {
  const commands = Array.from({ length: 1500 }, () => ({
    action: 'plan.create',
    values: { title: 'Synthetic', startDate: '2027-01-01' },
  }));
  expect(agentCommandsSchema.safeParse(commands).success).toBe(true);
  expect(agentCommandsSchema.safeParse([...commands, commands[0]]).success).toBe(false);
  expect(commandsSchema.safeParse(commands).success).toBe(false);
});
it('unions overlapping scan windows without confusing scans with measurement days', () => {
  const aggregate = historySummaryAccumulator(scope, q);
  for (const [id, from, to] of [
    ['a', '2023-12-01', '2024-01-20'],
    ['b', '2024-01-10', '2024-02-10'],
  ])
    aggregate.ingest({
      category: 'coverage',
      id: id!,
      date: '2024-01-01',
      data: {
        stream: 'sleep',
        from: from!,
        to: to!,
        scanState: 'scanned',
        lastScannedAt: '2024-02-10T00:00:00Z',
      },
    });
  const rows = aggregate.finish();
  expect(rows.find((r) => r.category === 'coverage' && r.source === 'sleep')).toMatchObject({
    count: 2,
    scannedDays: 31,
    unscannedDays: 0,
  });
  expect(
    rows.find((r) => r.category === 'health' && r.metric === 'sleepDurationSeconds'),
  ).toMatchObject({ contributingDays: 0, missingDays: 31, mean: null });
});
it('retains source-stream distinctions within an account and exposes unsupported metrics', () => {
  const aggregate = historySummaryAccumulator(scope, q);
  for (const [id, sourceStream, value, metric] of [
    ['a', 'daily', 50, 'restingHeartRateBpm'],
    ['b', 'sleep', 60, 'restingHeartRateBpm'],
    ['c', 'legacy', 123, 'legacyUnknownMetric'],
  ] as const)
    aggregate.ingest({
      category: 'health',
      id,
      date: '2024-01-01',
      data: { source: 'same-account', sourceStream, value, metric, revision: 1 },
    });
  const rows = aggregate.finish();
  const heartRate = rows.filter((r) => r.metric === 'restingHeartRateBpm' && r.contributingDays);
  expect(heartRate).toHaveLength(2);
  expect(heartRate.map((r) => r.mean).sort()).toEqual([50, 60]);
  expect(heartRate.every((r) => r.ambiguousDays === 1)).toBe(true);
  const unsupported = rows.find((r) => r.metric === 'legacyUnknownMetric')!;
  expect(unsupported).toMatchObject({
    count: 1,
    unsupportedRecords: 1,
    contributingDays: 0,
    mean: null,
    unit: 'unknown',
  });
  expect(unsupported.detailReferences![0]).toMatchObject({
    category: 'health',
    from: '2024-01-01',
    to: '2024-01-31',
  });
  expect(unsupported.detailReferences![0]!.metric).toBeUndefined();
});
