import {
  chartsLongLoadAverageDays,
  type ChartsLoadSession,
  type ChartsSummary,
} from '@athlete-panel/contracts';
import { addDays } from '../training/public/shared';
import { mean } from './resting-heart-rate-hrv';

export type HeartRateRange = { restingHeartRateBpm: number; maxHeartRateBpm: number };
export type LoadDay = {
  date: string;
  load: number | null;
  shortAverage: number | null;
  longAverage: number | null;
  hasSessionWithoutHeartRate: boolean;
  hasSessionWithoutDuration: boolean;
  loadLabel: string;
  shortAverageLabel: string;
  longAverageLabel: string;
};

export const shortAverageDays = 7;
export const shortAverageMinimumDays = 4;
export const longAverageMinimumDays = 24;
const banisterWeight = 0.64;
const banisterExponent = 1.92;

export function sessionLoad(
  { averageHeartRateBpm, durationSeconds }: ChartsLoadSession,
  { restingHeartRateBpm, maxHeartRateBpm }: HeartRateRange,
) {
  if (averageHeartRateBpm === null || durationSeconds === null) return null;
  const heartRateReserve = Math.min(
    1,
    Math.max(
      0,
      (averageHeartRateBpm - restingHeartRateBpm) / (maxHeartRateBpm - restingHeartRateBpm),
    ),
  );
  return (
    (durationSeconds / 60) *
    heartRateReserve *
    banisterWeight *
    Math.exp(banisterExponent * heartRateReserve)
  );
}

function loadLabel(
  total: {
    loadSum: number;
    sessionCount: number;
    sessionsWithoutHeartRate: number;
    sessionsWithoutDuration: number;
  },
  knownSessions: number,
) {
  const missing = [
    { count: total.sessionsWithoutHeartRate, input: 'heart rate' },
    { count: total.sessionsWithoutDuration, input: 'duration' },
  ].filter(({ count }) => count);
  if (!knownSessions)
    return missing.length === 2
      ? 'No heart rate or duration'
      : missing[0]!.input === 'heart rate'
        ? 'No heart rate'
        : 'Duration missing';
  if (!missing.length) return `${Math.round(total.loadSum)}`;
  const counts = missing.map(({ count, input }, index) =>
    index
      ? `${count} without ${input}`
      : `${count} of ${total.sessionCount} sessions without ${input}`,
  );
  return `${Math.round(total.loadSum)} (${counts.join(', ')})`;
}

export function dailyLoads(
  summary: ChartsSummary,
  limits: HeartRateRange,
  today: string,
): LoadDay[] {
  const firstDay = summary.weeks[0]!.weekStart;
  const sessionTotalsByDate = new Map<
    string,
    {
      loadSum: number;
      sessionCount: number;
      sessionsWithoutHeartRate: number;
      sessionsWithoutDuration: number;
    }
  >();
  for (const session of summary.trainingLoadSessions) {
    const total = sessionTotalsByDate.get(session.date) ?? {
      loadSum: 0,
      sessionCount: 0,
      sessionsWithoutHeartRate: 0,
      sessionsWithoutDuration: 0,
    };
    const withoutDuration = session.durationSeconds === null;
    const withoutHeartRate = !withoutDuration && session.averageHeartRateBpm === null;
    sessionTotalsByDate.set(session.date, {
      loadSum: total.loadSum + (sessionLoad(session, limits) ?? 0),
      sessionCount: total.sessionCount + 1,
      sessionsWithoutHeartRate: total.sessionsWithoutHeartRate + (withoutHeartRate ? 1 : 0),
      sessionsWithoutDuration: total.sessionsWithoutDuration + (withoutDuration ? 1 : 0),
    });
  }
  const unknownSessions = (date: string) => {
    const total = sessionTotalsByDate.get(date);
    return total ? total.sessionsWithoutHeartRate + total.sessionsWithoutDuration : 0;
  };
  const dayLoadIfComplete = (date: string) =>
    unknownSessions(date) ? null : (sessionTotalsByDate.get(date)?.loadSum ?? 0);
  const averageLoadOver = (date: string, days: number, minimumDays: number) => {
    const loads = Array.from({ length: days }, (_, index) =>
      dayLoadIfComplete(addDays(date, index + 1 - days)),
    ).filter((load) => load !== null);
    const value = loads.length >= minimumDays ? mean(loads) : null;
    const label =
      value === null
        ? 'Not enough days'
        : `${Math.round(value)}${loads.length < days ? ` (${loads.length} of ${days} days)` : ''}`;
    return { value, label };
  };
  return Array.from({ length: summary.weeks.length * 7 }, (_, index) => {
    const date = addDays(firstDay, index);
    if (date > today)
      return {
        date,
        load: null,
        shortAverage: null,
        longAverage: null,
        hasSessionWithoutHeartRate: false,
        hasSessionWithoutDuration: false,
        loadLabel: 'Upcoming',
        shortAverageLabel: 'Upcoming',
        longAverageLabel: 'Upcoming',
      };
    const total = sessionTotalsByDate.get(date);
    const shortAverage = averageLoadOver(date, shortAverageDays, shortAverageMinimumDays);
    const longAverage = averageLoadOver(date, chartsLongLoadAverageDays, longAverageMinimumDays);
    const knownSessions = total ? total.sessionCount - unknownSessions(date) : 0;
    return {
      date,
      load: knownSessions ? total!.loadSum : null,
      shortAverage: shortAverage.value,
      longAverage: longAverage.value,
      hasSessionWithoutHeartRate: !!total?.sessionsWithoutHeartRate,
      hasSessionWithoutDuration: !!total?.sessionsWithoutDuration,
      loadLabel: !total ? 'No sessions recorded' : loadLabel(total, knownSessions),
      shortAverageLabel: shortAverage.label,
      longAverageLabel: longAverage.label,
    };
  });
}
