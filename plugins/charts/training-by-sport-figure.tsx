'use client';

import { sportTypeLabel, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { ChartColumnStacked } from 'lucide-react';
import { duration, EmptyState } from '@athlete-panel/ui';
import { ChartFigure, periodText, bucketLabel, groupingLabels } from './chart-figure';
import { hasSessions } from './training-hours';
import { recordedSports, trainingBySportBuckets } from './training-by-sport';

const TrainingBySportChart = lazy(() => import('./training-by-sport-chart'));

export function TrainingBySportFigure({
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
      <EmptyState icon={<ChartColumnStacked size={25} />} title="No training in this period">
        Planned and recorded sessions will appear here.
      </EmptyState>
    );
  const grouping = summary.volume!.grouping;
  const labels = groupingLabels[grouping];
  const weeks = trainingBySportBuckets(summary, today, duration);
  const sports = recordedSports(summary);
  return (
    <ChartFigure
      title={`${labels.title} training by sport`}
      description={`Recorded hours per sport as stacked bars and planned hours as a dashed line, per ${grouping} ${periodText(weeks)}. Races are vertical lines.`}
      legend={[
        ...sports.map((sport) => ({
          label: sportTypeLabel(sport),
          keyClass: `charts-key-${sport}`,
        })),
        { label: 'Planned', keyClass: 'charts-key-planned' },
        ...(summary.races.length ? [{ label: 'Race', keyClass: 'charts-key-race' }] : []),
      ]}
      loading={loading}
      chart={
        <Suspense fallback={<div className="charts-plot" />}>
          <TrainingBySportChart weeks={weeks} sports={sports} />
        </Suspense>
      }
      headers={[labels.column, ...sports.map(sportTypeLabel), 'Recorded', 'Planned', 'Races']}
      rows={weeks.map((week) => ({
        key: week.startDate,
        cells: [
          bucketLabel(week),
          ...sports.map((sport) => week.labelBySport[sport]),
          week.recordedLabel,
          week.plannedLabel,
          week.races.join(', '),
        ],
      }))}
    />
  );
}
