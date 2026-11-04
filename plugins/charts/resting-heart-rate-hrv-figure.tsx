'use client';

import { chartsUsualRangeLookbackNights, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { HeartPulse } from 'lucide-react';
import { dateLabel, EmptyState } from '@athlete-panel/ui';
import { ChartFigure, periodText } from './chart-figure';
import {
  averageMinimumMeasuredNights,
  nightRows,
  metricUnit,
  usualRangeStandardDeviations,
  usualRangeMinimumNights,
  type NightMetric,
} from './resting-heart-rate-hrv';

const NightlyChart = lazy(() => import('./nightly-chart'));

const nightMetrics: { metric: NightMetric; title: string; name: string }[] = [
  { metric: 'restingHeartRateBpm', title: 'Resting heart rate', name: 'resting heart rate' },
  { metric: 'hrvMilliseconds', title: 'Heart rate variability (HRV)', name: 'HRV' },
];

export function RestingHeartRateHrvFigure({
  summary,
  today,
  loading,
}: {
  summary: ChartsSummary;
  today: string;
  loading: boolean;
}) {
  const figures = nightMetrics
    .map((item) => ({ ...item, rows: nightRows(summary, item.metric, today) }))
    .filter((item) => item.rows.some((row) => row.value !== null));
  if (!figures.length)
    return (
      <EmptyState icon={<HeartPulse size={25} />} title="No overnight data in this period">
        Resting heart rate and HRV from Garmin will appear here.
      </EmptyState>
    );
  return figures.map(({ metric, title, name, rows }) => {
    const mayBeMinimumCount = rows.filter((row) => row.mayBeMinimum).length;
    return (
      <ChartFigure
        key={metric}
        title={title}
        description={`Nightly ${name} as dots and its 7-night average as a line (from ${averageMinimumMeasuredNights} nights), ${periodText(summary.weeks)}. The band is your usual range: the average of the previous ${chartsUsualRangeLookbackNights} nights plus or minus ${usualRangeStandardDeviations} standard deviation, shown once ${usualRangeMinimumNights} nights are recorded.${mayBeMinimumCount ? ` On ${mayBeMinimumCount} nights Garmin reported the lowest heart rate of the day, not a resting value.` : ''}`}
        legend={[
          { label: 'Night', keyClass: 'charts-key-night' },
          { label: '7-day average', keyClass: 'charts-key-average' },
          { label: 'Usual range', keyClass: 'charts-key-usual-range' },
        ]}
        loading={loading}
        chart={
          <Suspense fallback={<div className="charts-plot" />}>
            <NightlyChart rows={rows} unit={metricUnit[metric]} />
          </Suspense>
        }
        headers={['Night', title, '7-day average', 'Usual range']}
        rows={rows.map((row) => ({
          key: row.date,
          cells: [dateLabel(row.date), row.valueLabel, row.averageLabel, row.usualRangeLabel],
        }))}
      />
    );
  });
}
