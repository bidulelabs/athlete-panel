'use client';

import { sportTypeLabel, type ChartsSport } from '@athlete-panel/contracts';
import { sportBars } from './sport-bars';
import { elevationUnitLabel, type UnitSystem, type ClimbingBucket } from './weekly-climbing';
import { GroupedChart } from './grouped-chart';

export default function ElevationChart({
  weeks,
  sports,
  units,
}: {
  weeks: ClimbingBucket[];
  sports: ChartsSport[];
  units: UnitSystem;
}) {
  return (
    <GroupedChart
      weeks={weeks}
      yLabel={elevationUnitLabel(units)}
      planned={false}
      target
      config={{}}
      tooltipRows={(week) =>
        week.sessionSports.map((sport): [string, string] => [
          sportTypeLabel(sport),
          week.elevationLabelBySport[sport],
        ])
      }
    >
      {sportBars(weeks, sports, (sport) => `elevationBySport.${sport}`)}
    </GroupedChart>
  );
}
