import { expect, it } from 'vitest';
import {
  uncovered,
  nextGap,
  healthBucket,
  windowCursor,
  nextReconciliation,
  type RecoveryContext,
} from '../../plugins/garmin/recovery-policy';
const context: RecoveryContext = {
  today: '2026-10-27',
  earliestDate: '2000-01-01',
  accountId: '555',
  generation: 'synthetic',
  timeZone: 'UTC',
};
it('merges overlapping and adjacent coverage and returns only genuinely unscanned gaps', () => {
  expect(
    uncovered('2026-09-01', '2026-10-20', [
      { from: '2026-09-01', to: '2026-09-09' },
      { from: '2026-09-08', to: '2026-09-15' },
      { from: '2026-09-16', to: '2026-10-01' },
      { from: '2026-10-10', to: '2026-10-27' },
    ]),
  ).toEqual([{ from: '2026-10-02', to: '2026-10-09' }]);
  expect(
    nextGap('sleep', context, [
      { stream: 'sleep', from: '2000-01-01', to: '2026-09-25' },
      { stream: 'sleep', from: '2026-10-21', to: '2026-10-27' },
    ]),
  ).toEqual({ from: healthBucket(context.earliestDate, '2026-10-20').from, to: '2026-10-20' });
});
it('keeps initial traversal ranges pending rather than rescanning them as catch-up', () => {
  expect(nextGap('sleep', context, [], [{ from: '2000-01-01', to: '2026-10-20' }])).toBeNull();
  expect(nextGap('activities', context, [])).toEqual({ from: '0001-01-01', to: '2026-10-20' });
});
it('walks stable historical buckets to the existing floor and restarts a cycle only after reaching it', () => {
  const floor = '2026-01-01',
    local = { ...context, earliestDate: floor };
  let cursor = windowCursor('sleep', healthBucket(floor, '2026-03-03'), local);
  const windows = [];
  for (;;) {
    windows.push({ from: cursor.earliestHealthDate, to: cursor.today });
    const next = nextReconciliation(cursor, { ...cursor, phase: 'done' }, local);
    if (!next) break;
    cursor = next;
  }
  expect(windows).toEqual([
    { from: '2026-02-26', to: '2026-03-03' },
    { from: '2026-01-29', to: '2026-02-25' },
    { from: floor, to: '2026-01-28' },
  ]);
});
it('keeps the complete activity traversal bound and page position until exhaustion', () => {
  const cursor = windowCursor('activities', { from: '0001-01-01', to: '2026-10-20' }, context);
  expect(cursor.activityFrom).toBeUndefined();
  const next = { ...cursor, activityOffset: 99 };
  expect(nextReconciliation(cursor, next, { ...context, today: '2026-11-03' })).toEqual(next);
  expect(nextReconciliation(cursor, { ...next, phase: 'done' }, context)).toBeNull();
});
