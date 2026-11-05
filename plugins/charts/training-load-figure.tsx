'use client';

import { chartsLongLoadAverageDays, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense } from 'react';
import { Activity } from 'lucide-react';
import { Button, dateLabel, EmptyState, useWorkspace } from '@athlete-panel/ui';
import { ChartFigure, periodText } from './chart-figure';
import {
  dailyLoads,
  longAverageMinimumDays,
  shortAverageDays,
  shortAverageMinimumDays,
} from './training-load';

const TrainingLoadChart = lazy(() => import('./training-load-chart'));

export function TrainingLoadFigure({
  summary,
  today,
  loading,
}: {
  summary: ChartsSummary;
  today: string;
  loading: boolean;
}) {
  const { data, navigate } = useWorkspace();
  const restingHeartRateBpm = data.profile?.restingHeartRateBpm;
  const maxHeartRateBpm = data.profile?.maxHeartRateBpm;
  if (!restingHeartRateBpm || !maxHeartRateBpm)
    return (
      <EmptyState
        icon={<Activity size={25} />}
        title="Set your resting and maximum heart rate in Settings"
        action={
          <Button variant="outline" className="button" onClick={() => navigate('/settings')}>
            Open Settings
          </Button>
        }
      >
        The estimate weighs each session by its average heart rate between those two values.
      </EmptyState>
    );
  const days = dailyLoads(summary, { restingHeartRateBpm, maxHeartRateBpm }, today);
  const pastDays = days.filter((day) => day.date <= today);
  if (!summary.trainingLoadSessions.length)
    return (
      <EmptyState icon={<Activity size={25} />} title="No training in this period">
        Recorded sessions with heart rate will appear here.
      </EmptyState>
    );
  const daysWithoutHeartRate = pastDays.filter((day) => day.hasSessionWithoutHeartRate).length;
  return (
    <ChartFigure
      title="Estimated training load"
      description={`An estimate, not a measurement: each day's load (Banister TRIMP) as bars, with its ${shortAverageDays}-day average (from ${shortAverageMinimumDays} days) and ${chartsLongLoadAverageDays}-day average (from ${longAverageMinimumDays} days) as lines, ${periodText(summary.weeks)}. Each session counts its minutes, weighted by where its average heart rate sits between your resting ${restingHeartRateBpm} and maximum ${maxHeartRateBpm} bpm.${daysWithoutHeartRate ? ` ${daysWithoutHeartRate} days have a session without heart rate and are left out of the averages.` : ''}`}
      legend={[
        { label: 'Daily load', keyClass: 'charts-key-load' },
        { label: `${shortAverageDays}-day average`, keyClass: 'charts-key-average' },
        {
          label: `${chartsLongLoadAverageDays}-day average`,
          keyClass: 'charts-key-long-average',
        },
      ]}
      loading={loading}
      chart={
        <Suspense fallback={<div className="charts-plot" />}>
          <TrainingLoadChart days={days} />
        </Suspense>
      }
      headers={[
        'Day',
        'Load',
        `${shortAverageDays}-day average`,
        `${chartsLongLoadAverageDays}-day average`,
      ]}
      rows={days.map((day) => ({
        key: day.date,
        cells: [dateLabel(day.date), day.loadLabel, day.shortAverageLabel, day.longAverageLabel],
      }))}
    />
  );
}
