import { chartsSports, type ChartsSport, type ChartsSummary } from '@athlete-panel/contracts';
import {
  durationLabel,
  sessionCount,
  trainingHoursWeeks,
  type TrainingHoursWeek,
} from './training-hours';

export const perSport = <Value>(value: (sport: ChartsSport) => Value) =>
  Object.fromEntries(chartsSports.map((sport) => [sport, value(sport)])) as Record<
    ChartsSport,
    Value
  >;

export type TrainingBySportWeek = TrainingHoursWeek & {
  sessionSports: ChartsSport[];
  hoursBySport: Record<ChartsSport, number | null>;
  labelBySport: Record<ChartsSport, string>;
};

export const recordedSports = (summary: ChartsSummary) =>
  chartsSports.filter((sport) =>
    summary.weeks.some((week) => sessionCount(week.recordedSecondsBySport[sport]) > 0),
  );

export function trainingBySportWeeks(
  summary: ChartsSummary,
  today: string,
  format: (seconds: number) => string,
): TrainingBySportWeek[] {
  return trainingHoursWeeks(summary, today, format).map((week, index) => {
    const bySport = summary.weeks[index]!.recordedSecondsBySport;
    const upcoming = week.weekStart > today;
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
