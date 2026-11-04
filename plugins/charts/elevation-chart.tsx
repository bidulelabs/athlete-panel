'use client';

import { sportTypeLabel, type ChartsSport } from '@athlete-panel/contracts';
import { sportBars } from './sport-bars';
import { elevationUnitLabel, type UnitSystem, type ClimbingWeek } from './weekly-climbing';
import { WeeklyChart } from './weekly-chart';

export default function ElevationChart({
  weeks,
  sports,
  units,
}: {
  weeks: ClimbingWeek[];
  sports: ChartsSport[];
  units: UnitSystem;
}) {
  return (
    <WeeklyChart
      weeks={weeks}
      yLabel={elevationUnitLabel(units)}
      planned={false}
      config={{}}
      tooltipRows={(week) =>
        week.sessionSports.map((sport): [string, string] => [
          sportTypeLabel(sport),
          week.elevationLabelBySport[sport],
        ])
      }
    >
      {sportBars(weeks, sports, (sport) => `elevationBySport.${sport}`)}
    </WeeklyChart>
  );
}
