'use client';

import { sportTypeLabel, type ChartsSport, type ChartsSummary } from '@athlete-panel/contracts';
import { lazy, Suspense, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { addDays, dateLabel, duration, EmptyState, Field, NativeSelect } from '@athlete-panel/ui';
import { ChartFigure, periodText } from './chart-figure';
import {
  sportWithMostHeartRate,
  heartRateSessions,
  sportsWithHeartRate,
} from './workout-heart-rate';

const WorkoutHeartRateChart = lazy(() => import('./workout-heart-rate-chart'));

export function WorkoutHeartRateFigure({
  summary,
  loading,
}: {
  summary: ChartsSummary;
  loading: boolean;
}) {
  const [chosenSport, setChosenSport] = useState<ChartsSport | null>(null);
  const sports = sportsWithHeartRate(summary);
  if (!sports.length)
    return (
      <EmptyState icon={<HeartPulse size={25} />} title="No heart rate in this period">
        {summary.sessions.length
          ? `${summary.sessions.length} recorded sessions have no average heart rate.`
          : 'Recorded sessions with an average heart rate will appear here.'}
      </EmptyState>
    );
  const sport =
    chosenSport && sports.includes(chosenSport)
      ? chosenSport
      : sportWithMostHeartRate(summary, sports);
  const sessions = heartRateSessions(summary, sport, duration);
  const withoutHeartRate = sessions.filter(
    (session) => session.averageHeartRateBpm === null,
  ).length;
  return (
    <>
      <div className="charts-sport-filter">
        <Field label="Sport">
          <NativeSelect
            value={sport}
            onChange={(event) => setChosenSport(event.target.value as ChartsSport)}
          >
            {sports.map((item) => (
              <option key={item} value={item}>
                {sportTypeLabel(item)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <ChartFigure
        title={`${sportTypeLabel(sport)} heart rate per session`}
        description={`Average heart rate of each ${sportTypeLabel(sport).toLowerCase()} session ${periodText(summary.weeks)}.${withoutHeartRate ? ` Sessions without heart rate (${withoutHeartRate}) appear in the table only.` : ''}`}
        legend={[]}
        loading={loading}
        chart={
          <Suspense fallback={<div className="charts-plot" />}>
            <WorkoutHeartRateChart
              sessions={sessions}
              sport={sport}
              from={summary.weeks[0]!.weekStart}
              to={addDays(summary.weeks.at(-1)!.weekStart, 6)}
            />
          </Suspense>
        }
        headers={['Date', 'Session', 'Average heart rate', 'Duration']}
        rows={sessions.map((session) => ({
          key: session.id,
          cells: [
            dateLabel(session.date),
            session.title,
            session.heartRateLabel,
            session.durationLabel,
          ],
        }))}
      />
    </>
  );
}
