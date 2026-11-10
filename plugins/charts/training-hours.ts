import {
  chartsSports,
  sportTypeLabel,
  type ChartsSummary,
  type ChartsGrouping,
} from '@athlete-panel/contracts';
import { type MetricTotal } from '../training/public/shared';

export type TrainingHoursBucket = {
  startDate: string;
  endDate: string;
  grouping: ChartsGrouping;
  partial: boolean;
  inProgress: boolean;
  recordedHours: number | null;
  plannedHours: number | null;
  recordedLabel: string;
  plannedLabel: string;
  targetRange: [number, number] | null;
  targetLabel: string;
  races: string[];
};

export const sessionCount = (measure: MetricTotal) => measure.knownCount + measure.missingCount;
export function durationLabel(measure: MetricTotal, format: (seconds: number) => string) {
  if (measure.value === null) return 'Duration missing';
  if (!measure.missingCount) return format(measure.value);
  return `${format(measure.value)} (${measure.missingCount} of ${sessionCount(measure)} sessions without duration)`;
}

export function targetRangeLabel(
  target: { min: number; max: number } | null,
  format: (value: number) => string,
) {
  if (!target) return 'No target';
  return format(target.min) === format(target.max)
    ? format(target.min)
    : `${format(target.min)}–${format(target.max)}`;
}

export function trainingHoursBuckets(
  summary: ChartsSummary,
  today: string,
  format: (seconds: number) => string,
): TrainingHoursBucket[] {
  return (summary.volume?.buckets ?? []).map(
    ({ startDate, endDate, partial, recordedSeconds, plannedSeconds, targetSeconds }) => {
      const upcoming = startDate > today;
      const noPlan = sessionCount(plannedSeconds) === 0;
      const noSessions = sessionCount(recordedSeconds) === 0;
      return {
        startDate,
        endDate,
        partial,
        grouping: summary.volume!.grouping,
        inProgress: startDate <= today && today <= endDate,
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
        targetRange: targetSeconds && [targetSeconds.min / 3600, targetSeconds.max / 3600],
        targetLabel: targetRangeLabel(targetSeconds, format),
        races: summary.races
          .filter((race) => race.date >= startDate && race.date <= endDate)
          .map((race) => race.title),
      };
    },
  );
}

export function hasSessionsOrTargets(summary: ChartsSummary) {
  return (summary.volume?.buckets ?? []).some(
    (week) =>
      sessionCount(week.recordedSeconds) > 0 ||
      sessionCount(week.plannedSeconds) > 0 ||
      week.targetSeconds !== null ||
      week.targetElevationMeters !== null,
  );
}

export const hasTargets = (weeks: TrainingHoursBucket[]) =>
  weeks.some((week) => week.targetRange !== null);

export function emptyTrainingTitle(summary: ChartsSummary) {
  const sports = summary.volume?.sports ?? chartsSports;
  if (sports.length === chartsSports.length) return 'No training in this period';
  return sports.length === 1
    ? `No ${sportTypeLabel(sports[0]!).toLowerCase()} sessions in this period`
    : 'No sessions for the selected sports in this period';
}
