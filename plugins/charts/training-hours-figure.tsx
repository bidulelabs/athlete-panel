'use client';

import type { ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { ChartColumn } from 'lucide-react';
import { duration, EmptyState } from '@athlete-panel/ui';
import { ChartFigure, periodText, bucketLabel, groupingLabels } from './chart-figure';
import { hasSessions, trainingHoursBuckets } from './training-hours';

const TrainingHoursChart = lazy(() => import('./training-hours-chart'));

export function TrainingHoursFigure({
  summary,
  today,
  loading,
}: {
  summary: ChartsSummary;
  today: string;
  loading: boolean;
}) {
  if (!hasSessions(summary))
    return (
      <EmptyState icon={<ChartColumn size={25} />} title="No training in this period">
        Planned and recorded sessions will appear here.
      </EmptyState>
    );
  const grouping = summary.volume!.grouping;
  const labels = groupingLabels[grouping];
  const weeks = trainingHoursBuckets(summary, today, duration);
  return (
    <ChartFigure
      title={`${labels.title} training hours`}
      description={`Recorded hours as bars and planned hours as a dashed line, per ${grouping} ${periodText(weeks)}. Races are vertical lines.`}
      legend={[
        { label: 'Recorded', keyClass: 'charts-key-recorded' },
        { label: 'Planned', keyClass: 'charts-key-planned' },
        ...(summary.races.length ? [{ label: 'Race', keyClass: 'charts-key-race' }] : []),
      ]}
      loading={loading}
      chart={
        <Suspense fallback={<div className="charts-plot" />}>
          <TrainingHoursChart weeks={weeks} />
        </Suspense>
      }
      headers={[labels.column, 'Recorded', 'Planned', 'Races']}
      rows={weeks.map((week) => ({
        key: week.startDate,
        cells: [bucketLabel(week), week.recordedLabel, week.plannedLabel, week.races.join(', ')],
      }))}
    />
  );
}
