'use client';

import { sportTypeLabel, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { Mountain } from 'lucide-react';
import { EmptyState, useWorkspace } from '@athlete-panel/ui';
import { ChartFigure, periodText, bucketLabel, groupingLabels } from './chart-figure';
import { hasSessions } from './training-hours';
import { sportsWithElevation, climbUnitLabel, climbingBuckets } from './weekly-climbing';

const ElevationChart = lazy(() => import('./elevation-chart'));
const RunningClimbChart = lazy(() => import('./running-climb-chart'));

export function WeeklyClimbingFigure({
  summary,
  today,
  loading,
}: {
  summary: ChartsSummary;
  today: string;
  loading: boolean;
}) {
  const units = useWorkspace().data.profile?.units ?? 'metric';
  if (!hasSessions(summary))
    return (
      <EmptyState icon={<Mountain size={25} />} title="No training in this period">
        Planned and recorded sessions will appear here.
      </EmptyState>
    );
  const grouping = summary.volume!.grouping;
  const labels = groupingLabels[grouping];
  const weeks = climbingBuckets(summary, today, units);
  const sports = sportsWithElevation(summary);
  const raceKey = summary.races.length ? [{ label: 'Race', keyClass: 'charts-key-race' }] : [];
  const distanceName = units === 'imperial' ? 'mile' : 'kilometre';
  return (
    <>
      <ChartFigure
        title={`${labels.title} elevation gain by sport`}
        description={`Recorded elevation gain per sport as stacked bars, in ${units === 'imperial' ? 'feet' : 'metres'}, per ${grouping} ${periodText(weeks)}. Races are vertical lines.`}
        legend={[
          ...sports.map((sport) => ({
            label: sportTypeLabel(sport),
            keyClass: `charts-key-${sport}`,
          })),
          ...raceKey,
        ]}
        loading={loading}
        chart={
          <Suspense fallback={<div className="charts-plot" />}>
            <ElevationChart weeks={weeks} sports={sports} units={units} />
          </Suspense>
        }
        headers={[labels.column, ...sports.map(sportTypeLabel), 'Races']}
        rows={weeks.map((week) => ({
          key: week.startDate,
          cells: [
            bucketLabel(week),
            ...sports.map((sport) => week.elevationLabelBySport[sport]),
            week.races.join(', '),
          ],
        }))}
      />
      {summary.volume!.sports.includes('running') && (
        <ChartFigure
          title={`Running climb per ${distanceName}`}
          description={`Running elevation gain divided by running distance, in ${climbUnitLabel(units)}, per ${grouping} ${periodText(weeks)}. Periods with missing elevation or distance use the measured sessions and read partial.`}
          legend={raceKey}
          loading={loading}
          chart={
            <Suspense fallback={<div className="charts-plot" />}>
              <RunningClimbChart weeks={weeks} units={units} />
            </Suspense>
          }
          headers={[labels.column, 'Running climb', 'Races']}
          rows={weeks.map((week) => ({
            key: week.startDate,
            cells: [bucketLabel(week), week.runningClimbLabel, week.races.join(', ')],
          }))}
        />
      )}
    </>
  );
}
