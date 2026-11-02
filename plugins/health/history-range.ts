import { dateSchema } from '@athlete-panel/contracts';
import { addDays } from '@athlete-panel/ui/calendar-dates';

export const historyPeriods = [7, 30, 90] as const;
export type HistoryPeriod = (typeof historyPeriods)[number];
// Leave room for the longest period within the supported floating-date contract.
export const earliestHistoryEnd = '0001-03-31';

export function validHistoryEnd(date: string, today: string) {
  return dateSchema.safeParse(date).success && date >= earliestHistoryEnd && date <= today;
}

export function historyRange(to: string, days: HistoryPeriod) {
  const from = addDays(to, 1 - days);
  return { from, to, dates: Array.from({ length: days }, (_, index) => addDays(from, index)) };
}

export function moveHistoryEnd(to: string, days: HistoryPeriod, direction: -1 | 1, today: string) {
  if (direction === -1)
    return to < addDays(earliestHistoryEnd, days) ? earliestHistoryEnd : addDays(to, -days);
  return to > addDays(today, -days) ? today : addDays(to, days);
}
