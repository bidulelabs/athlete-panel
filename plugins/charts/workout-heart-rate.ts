import {
  chartsSports,
  type ChartsSession,
  type ChartsSport,
  type ChartsSummary,
} from '@athlete-panel/contracts';

export type HeartRateSession = ChartsSession & {
  time: number;
  heartRateLabel: string;
  durationLabel: string;
};

const heartRateSessionCount = (summary: ChartsSummary, sport: ChartsSport) =>
  summary.sessions.filter(
    (session) => session.sport === sport && session.averageHeartRateBpm !== null,
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
  return summary.sessions
    .filter((session) => session.sport === sport)
    .map((session) => ({
      ...session,
      time: Date.parse(`${session.date}T12:00:00Z`),
      heartRateLabel:
        session.averageHeartRateBpm === null
          ? 'No heart rate'
          : `${Math.round(session.averageHeartRateBpm)} bpm`,
      durationLabel:
        session.durationSeconds === null ? 'Duration missing' : format(session.durationSeconds),
    }));
}
