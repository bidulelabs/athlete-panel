import type { ImportStream } from '@athlete-panel/contracts';
import { HEALTH_STREAMS } from './normalize';
import { addDays, createSyncCursor, type GarminSyncCursor } from './sync';

export const RECOVERY_STREAMS: ImportStream[] = ['activities', ...HEALTH_STREAMS];
export type DateRange = { from: string; to: string };
export type SuccessfulRange = DateRange & { stream: string };
export type RecoveryContext = {
  today: string;
  earliestDate: string;
  accountId: string;
  generation: string;
  timeZone: string;
};

/** Inclusive calendar intervals, not counts of measurements or a global last-sync timestamp. */
export function uncovered(from: string, to: string, ranges: DateRange[]): DateRange[] {
  if (from > to) return [];
  let next = from;
  const gaps: DateRange[] = [];
  for (const range of [...ranges].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  )) {
    if (range.to < next || range.from > to) continue;
    if (range.from > next) gaps.push({ from: next, to: addDays(range.from, -1) });
    if (range.to >= to) return gaps;
    next = addDays(range.to, 1);
  }
  if (next <= to) gaps.push({ from: next, to });
  return gaps;
}

/** Stable buckets avoid creating a different historical coverage row on every new cycle. */
export function healthBucket(floor: string, end: string): DateRange {
  const days = Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${floor}T00:00:00Z`)) / 86400000,
  );
  const from = addDays(floor, Math.floor(days / 28) * 28);
  return { from, to: end };
}
export function windowCursor(
  stream: ImportStream,
  range: DateRange,
  context: RecoveryContext,
): GarminSyncCursor {
  const cursor = createSyncCursor({
    today: range.to,
    earliestHealthDate:
      stream === 'activities'
        ? range.from === '0001-01-01'
          ? context.earliestDate < range.to
            ? context.earliestDate
            : range.to
          : range.from
        : range.from,
    ...(stream === 'activities' && range.from !== '0001-01-01' ? { activityFrom: range.from } : {}),
    accountId: context.accountId,
    timeZone: context.timeZone,
    mode: 'initial',
    targetStream: stream,
  });
  cursor.phase = stream === 'activities' ? 'recent-activities' : 'recent-health';
  cursor.healthStreamIndex = stream === 'activities' ? 0 : HEALTH_STREAMS.indexOf(stream);
  return cursor;
}
export function nextGap(
  stream: ImportStream,
  context: RecoveryContext,
  ranges: SuccessfulRange[],
  pending: DateRange[] = [],
): DateRange | null {
  const end = addDays(context.today, -7),
    floor = stream === 'activities' ? '0001-01-01' : context.earliestDate;
  const gap = uncovered(floor, end, [
    ...ranges.filter((row) => row.stream === stream),
    ...pending,
  ]).at(-1);
  if (!gap || stream === 'activities') return gap ?? null;
  const bucket = healthBucket(context.earliestDate, gap.to);
  return { from: gap.from > bucket.from ? gap.from : bucket.from, to: gap.to };
}
