'use client';

import { Bar, Cell } from 'recharts';
import type { ChartConfig } from '@athlete-panel/ui/components/chart';
import type { TrainingHoursWeek } from './training-hours';
import { WeeklyChart } from './weekly-chart';

const config = {
  recordedHours: { label: 'Recorded', color: 'var(--chart-recorded)' },
} satisfies ChartConfig;

export default function TrainingHoursChart({ weeks }: { weeks: TrainingHoursWeek[] }) {
  return (
    <WeeklyChart
      weeks={weeks}
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
            key={week.weekStart}
            fill={week.inProgress ? 'transparent' : 'var(--color-recordedHours)'}
            stroke={week.inProgress ? 'var(--color-recordedHours)' : 'none'}
            strokeWidth={1.5}
          />
        ))}
      </Bar>
    </WeeklyChart>
  );
}
