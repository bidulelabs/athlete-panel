'use client';

import { sportTypeLabel, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { ChartColumnStacked } from 'lucide-react';
import { duration, EmptyState } from '@athlete-panel/ui';
import { ChartFigure, periodText, bucketLabel, groupingLabels } from './chart-figure';
import { emptyTrainingTitle, hasSessionsOrTargets, hasTargets } from './training-hours';
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
  if (!hasSessionsOrTargets(summary))
    return (
      <EmptyState icon={<ChartColumnStacked size={25} />} title={emptyTrainingTitle(summary)}>
        Planned and recorded sessions will appear here.
      </EmptyState>
    );
  const grouping = summary.volume!.grouping;
  const labels = groupingLabels[grouping];
  const weeks = trainingBySportBuckets(summary, today, duration);
  const sports = recordedSports(summary);
  const target = hasTargets(weeks);
  return (
    <ChartFigure
      title={`${labels.title} training by sport`}
      description={`Recorded hours per sport as stacked bars and planned hours as a dashed line${target ? ', phase target as a band' : ''}, per ${grouping} ${periodText(weeks)}. Races are vertical lines.`}
      legend={[
        ...sports.map((sport) => ({
          label: sportTypeLabel(sport),
          keyClass: `charts-key-${sport}`,
        })),
        { label: 'Planned', keyClass: 'charts-key-planned' },
        ...(target ? [{ label: 'Target', keyClass: 'charts-key-target' }] : []),
        ...(summary.races.length ? [{ label: 'Race', keyClass: 'charts-key-race' }] : []),
      ]}
      loading={loading}
      chart={
        <Suspense fallback={<div className="charts-plot" />}>
          <TrainingBySportChart weeks={weeks} sports={sports} />
        </Suspense>
      }
      headers={[
        labels.column,
        ...sports.map(sportTypeLabel),
        'Recorded',
        'Planned',
        ...(target ? ['Target'] : []),
        'Races',
      ]}
      rows={weeks.map((week) => ({
        key: week.startDate,
        cells: [
          bucketLabel(week),
          ...sports.map((sport) => week.labelBySport[sport]),
          week.recordedLabel,
          week.plannedLabel,
          ...(target ? [week.targetLabel] : []),
          week.races.join(', '),
        ],
      }))}
    />
  );
}
