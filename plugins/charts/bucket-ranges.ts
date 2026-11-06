import type { ChartsGrouping } from '@athlete-panel/contracts';
import { addDays } from '../training/public/shared';

/** Keep the selected Calendar weeks fixed; only their display buckets change. */
export function bucketRanges(weekStart: string, weeks: number, grouping: ChartsGrouping) {
  const lastDay = addDays(weekStart, weeks * 7 - 1);
  const ranges: { startDate: string; endDate: string; partial: boolean }[] = [];
  for (let startDate = weekStart; startDate <= lastDay;) {
    const naturalStart = grouping === 'month' ? `${startDate.slice(0, 7)}-01` : startDate;
    const nextMonth = new Date(`${naturalStart}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const naturalEnd =
      grouping === 'month'
        ? addDays(nextMonth.toISOString().slice(0, 10), -1)
        : addDays(startDate, grouping === 'week' ? 6 : 0);
    const endDate = naturalEnd > lastDay ? lastDay : naturalEnd;
    ranges.push({
      startDate,
      endDate,
      partial: startDate !== naturalStart || endDate !== naturalEnd,
    });
    startDate = addDays(endDate, 1);
  }
  return ranges;
}
