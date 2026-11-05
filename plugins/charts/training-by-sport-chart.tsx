'use client';

import { sportTypeLabel, type ChartsSport } from '@athlete-panel/contracts';
import { sportBars } from './sport-bars';
import type { TrainingBySportWeek } from './training-by-sport';
import { WeeklyChart } from './weekly-chart';

export default function TrainingBySportChart({
  weeks,
  sports,
}: {
  weeks: TrainingBySportWeek[];
  sports: ChartsSport[];
}) {
  return (
    <WeeklyChart
      weeks={weeks}
      yLabel="Hours"
      planned
      config={{}}
      tooltipRows={(week) => [
        ...week.sessionSports.map((sport): [string, string] => [
          sportTypeLabel(sport),
          week.labelBySport[sport],
        ]),
        ['Recorded', week.recordedLabel],
        ['Planned', week.plannedLabel],
      ]}
    >
      {sportBars(weeks, sports, (sport) => `hoursBySport.${sport}`)}
    </WeeklyChart>
  );
}
