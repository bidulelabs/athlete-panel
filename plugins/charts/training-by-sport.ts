import { chartsSports, type ChartsSport, type ChartsSummary } from '@athlete-panel/contracts';
import {
  durationLabel,
  sessionCount,
  trainingHoursBuckets,
  type TrainingHoursBucket,
} from './training-hours';

export const perSport = <Value>(value: (sport: ChartsSport) => Value) =>
  Object.fromEntries(chartsSports.map((sport) => [sport, value(sport)])) as Record<
    ChartsSport,
    Value
  >;

export type TrainingBySportBucket = TrainingHoursBucket & {
  sessionSports: ChartsSport[];
  hoursBySport: Record<ChartsSport, number | null>;
  labelBySport: Record<ChartsSport, string>;
};

export const recordedSports = (summary: ChartsSummary) =>
  chartsSports.filter((sport) =>
    (summary.volume?.buckets ?? []).some(
      (week) => sessionCount(week.recordedSecondsBySport[sport]) > 0,
    ),
  );

export function trainingBySportBuckets(
  summary: ChartsSummary,
  today: string,
  format: (seconds: number) => string,
): TrainingBySportBucket[] {
  return trainingHoursBuckets(summary, today, format).map((week, index) => {
    const bySport = summary.volume!.buckets[index]!.recordedSecondsBySport;
    const upcoming = week.startDate > today;
    const noSessions = (sport: ChartsSport) => sessionCount(bySport[sport]) === 0;
    return {
      ...week,
      sessionSports: chartsSports.filter((sport) => sessionCount(bySport[sport]) > 0),
      hoursBySport: perSport((sport) => {
        const seconds = bySport[sport].value;
        return upcoming || noSessions(sport) || seconds === null ? null : seconds / 3600;
      }),
      labelBySport: perSport((sport) =>
        upcoming
          ? 'Upcoming'
          : noSessions(sport)
            ? 'No sessions recorded'
            : durationLabel(bySport[sport], format),
      ),
    };
  });
}
