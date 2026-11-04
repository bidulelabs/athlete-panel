import {
  chartsSports,
  type ChartsActivity,
  type ChartsSport,
  type ChartsSummary,
} from '@athlete-panel/contracts';

export type HeartRateSession = ChartsActivity & {
  time: number;
  heartRateLabel: string;
  durationLabel: string;
};

const heartRateSessionCount = (summary: ChartsSummary, sport: ChartsSport) =>
  summary.activities.filter(
    (activity) => activity.sport === sport && activity.averageHeartRateBpm !== null,
  ).length;

export const sportsWithHeartRate = (summary: ChartsSummary) =>
  chartsSports.filter((sport) => heartRateSessionCount(summary, sport) > 0);

export const sportWithMostHeartRate = (summary: ChartsSummary, sports: ChartsSport[]) =>
  sports.reduce((busiest, sport) =>
    heartRateSessionCount(summary, sport) > heartRateSessionCount(summary, busiest)
      ? sport
      : busiest,
  );

export function heartRateSessions(
  summary: ChartsSummary,
  sport: ChartsSport,
  format: (seconds: number) => string,
): HeartRateSession[] {
  return summary.activities
    .filter((activity) => activity.sport === sport)
    .map((activity) => ({
      ...activity,
      time: Date.parse(`${activity.date}T12:00:00Z`),
      heartRateLabel:
        activity.averageHeartRateBpm === null
          ? 'No heart rate'
          : `${Math.round(activity.averageHeartRateBpm)} bpm`,
      durationLabel:
        activity.durationSeconds === null ? 'Duration missing' : format(activity.durationSeconds),
    }));
}
