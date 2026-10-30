import { expect, it } from 'vitest';
import {
  uncovered,
  nextGap,
  healthBucket,
  windowCursor,
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
it('does not revisit completed history, including empty scans and adjacent coverage', () => {
  for (const stream of ['activities', 'sleep'] as const) {
    const floor = stream === 'activities' ? '0001-01-01' : context.earliestDate;
    expect(
      nextGap(stream, context, [
        { stream, from: floor, to: '2026-10-01' },
        { stream, from: '2026-10-02', to: context.today },
      ]),
    ).toBeNull();
  }
  expect(
    windowCursor('activities', { from: '0001-01-01', to: '2026-10-20' }, context).activityFrom,
  ).toBeUndefined();
  expect(
    windowCursor('activities', { from: '0001-01-01', to: '1999-12-31' }, context),
  ).toMatchObject({
    today: '1999-12-31',
    earliestHealthDate: '1999-12-31',
    targetStream: 'activities',
  });
});
