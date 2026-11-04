import { chartsUsualRangeLookbackNights, type ChartsSummary } from '@athlete-panel/contracts';
import { addDays } from '../training/public/shared';

export type NightMetric = 'restingHeartRateBpm' | 'hrvMilliseconds';
export type NightRow = {
  date: string;
  value: number | null;
  mayBeMinimum: boolean;
  average: number | null;
  usualRange: [number, number] | null;
  valueLabel: string;
  averageLabel: string;
  usualRangeLabel: string;
};

export const metricUnit = { restingHeartRateBpm: 'bpm', hrvMilliseconds: 'ms' } as const;
export const averageNights = 7;
export const averageMinimumMeasuredNights = 4;
export const usualRangeMinimumNights = 30;
export const usualRangeStandardDeviations = 0.75;

export const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export function nightRows(summary: ChartsSummary, metric: NightMetric, today: string): NightRow[] {
  const unit = metricUnit[metric];
  const measured = summary.nights.filter((night) => night[metric] !== null);
  const valuesBetween = (from: string, to: string) =>
    measured
      .filter((night) => night.date >= from && night.date <= to)
      .map((night) => night[metric]!);
  const firstDay = summary.weeks[0]!.weekStart;
  return Array.from({ length: summary.weeks.length * 7 }, (_, index) => {
    const date = addDays(firstDay, index);
    if (date > today)
      return {
        date,
        value: null,
        mayBeMinimum: false,
        average: null,
        usualRange: null,
        valueLabel: 'Upcoming',
        averageLabel: 'Upcoming',
        usualRangeLabel: 'Upcoming',
      };
    const night = measured.find((item) => item.date === date);
    const value = night?.[metric] ?? null;
    const mayBeMinimum = metric === 'restingHeartRateBpm' && !!night?.restingHeartRateMayBeMinimum;
    const lastNights = valuesBetween(addDays(date, 1 - averageNights), date);
    const baseline = valuesBetween(
      addDays(date, -chartsUsualRangeLookbackNights),
      addDays(date, -1),
    );
    const baselineMean = mean(baseline);
    const spread =
      usualRangeStandardDeviations *
      Math.sqrt(mean(baseline.map((item) => (item - baselineMean) ** 2)));
    const average = lastNights.length >= averageMinimumMeasuredNights ? mean(lastNights) : null;
    const usualRange: [number, number] | null =
      baseline.length >= usualRangeMinimumNights
        ? [baselineMean - spread, baselineMean + spread]
        : null;
    return {
      date,
      value,
      mayBeMinimum,
      average,
      usualRange,
      valueLabel:
        value === null
          ? 'No measure'
          : `${Math.round(value)} ${unit}${mayBeMinimum ? ' (daily minimum)' : ''}`,
      averageLabel:
        average === null
          ? 'Not enough nights'
          : `${Math.round(average)} ${unit}${lastNights.length < averageNights ? ` (${lastNights.length} of ${averageNights} nights)` : ''}`,
      usualRangeLabel: usualRange
        ? `${Math.round(usualRange[0])} to ${Math.round(usualRange[1])} ${unit}`
        : 'Not enough nights',
    };
  });
}
