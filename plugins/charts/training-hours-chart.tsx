'use client';

import { Bar, Cell } from 'recharts';
import type { ChartConfig } from '@athlete-panel/ui/components/chart';
import type { TrainingHoursBucket } from './training-hours';
import { GroupedChart } from './grouped-chart';

const config = {
  recordedHours: { label: 'Recorded', color: 'var(--chart-recorded)' },
} satisfies ChartConfig;

export default function TrainingHoursChart({ weeks }: { weeks: TrainingHoursBucket[] }) {
  return (
    <GroupedChart
      weeks={weeks}
      yLabel="Hours"
      planned
      target
      config={config}
      tooltipRows={(week) => [
        ['Recorded', week.recordedLabel],
        ['Planned', week.plannedLabel],
      ]}
    >
      <Bar
        dataKey="recordedHours"
        fill="var(--color-recordedHours)"
        maxBarSize={24}
        radius={[4, 4, 0, 0]}
        animationDuration={180}
        animationEasing="ease"
      >
        {weeks.map((week) => (
          <Cell
            key={week.startDate}
            fill={week.inProgress ? 'transparent' : 'var(--color-recordedHours)'}
            stroke={week.inProgress ? 'var(--color-recordedHours)' : 'none'}
            strokeWidth={1.5}
          />
        ))}
      </Bar>
    </GroupedChart>
  );
}
