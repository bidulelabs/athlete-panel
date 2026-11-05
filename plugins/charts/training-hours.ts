import type { ChartsSummary } from '@athlete-panel/contracts';
import { addDays, type MetricTotal } from '../training/public/shared';

export type TrainingHoursWeek = {
  weekStart: string;
  inProgress: boolean;
  recordedHours: number | null;
  plannedHours: number | null;
  recordedLabel: string;
  plannedLabel: string;
  races: string[];
};

export const sessionCount = (measure: MetricTotal) => measure.knownCount + measure.missingCount;
export function durationLabel(measure: MetricTotal, format: (seconds: number) => string) {
  if (measure.value === null) return 'Duration missing';
  if (!measure.missingCount) return format(measure.value);
  return `${format(measure.value)} (${measure.missingCount} of ${sessionCount(measure)} sessions without duration)`;
}

export function trainingHoursWeeks(
  summary: ChartsSummary,
  today: string,
  format: (seconds: number) => string,
): TrainingHoursWeek[] {
  return summary.weeks.map(({ weekStart, recordedSeconds, plannedSeconds }) => {
    const weekEnd = addDays(weekStart, 6);
    const upcoming = weekStart > today;
    const noPlan = sessionCount(plannedSeconds) === 0;
    const noSessions = sessionCount(recordedSeconds) === 0;
    return {
      weekStart,
      inProgress: weekStart <= today && today <= weekEnd,
      recordedHours:
        upcoming || noSessions || recordedSeconds.value === null
          ? null
          : recordedSeconds.value / 3600,
      plannedHours: noPlan || plannedSeconds.value === null ? null : plannedSeconds.value / 3600,
      recordedLabel: upcoming
        ? 'Upcoming'
        : noSessions
          ? 'No sessions recorded'
          : durationLabel(recordedSeconds, format),
      plannedLabel: noPlan ? 'No plan' : durationLabel(plannedSeconds, format),
      races: summary.races
        .filter((race) => race.date >= weekStart && race.date <= weekEnd)
        .map((race) => race.title),
    };
  });
}

export function hasSessions(summary: ChartsSummary) {
  return summary.weeks.some(
    (week) => sessionCount(week.recordedSeconds) > 0 || sessionCount(week.plannedSeconds) > 0,
  );
}
