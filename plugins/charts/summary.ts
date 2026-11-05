import type { ChartsSummary, ChartsSummaryInput, WorkspaceState } from '@athlete-panel/contracts';
import { addDays, weeklySummary } from '../training/public/shared';

export function chartsSummary(
  state: WorkspaceState,
  { weekStart, weeks }: ChartsSummaryInput,
): ChartsSummary {
  const lastDay = addDays(weekStart, weeks * 7 - 1);
  return {
    weeks: Array.from({ length: weeks }, (_, index) => {
      const week = weeklySummary(state, addDays(weekStart, index * 7));
      return {
        weekStart: week.startDate,
        plannedSeconds: week.planned.durationSeconds,
        recordedSeconds: week.actual.durationSeconds,
      };
    }),
    races: state.events
      .filter((event) => event.kind === 'race' && event.date >= weekStart && event.date <= lastDay)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(({ id, date, title }) => ({ id, date, title })),
  };
}
