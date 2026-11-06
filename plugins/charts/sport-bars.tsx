'use client';

import type { ChartsSport } from '@athlete-panel/contracts';
import { Bar, Cell } from 'recharts';

export const sportColor = (sport: ChartsSport) => `var(--chart-${sport.replaceAll('_', '-')})`;

export function sportBars(
  weeks: { startDate: string; inProgress: boolean }[],
  sports: ChartsSport[],
  dataKey: (sport: ChartsSport) => string,
) {
  return sports.map((sport) => (
    <Bar
      key={sport}
      dataKey={dataKey(sport)}
      stackId="sports"
      fill={sportColor(sport)}
      maxBarSize={24}
      animationDuration={180}
      animationEasing="ease"
    >
      {weeks.map((week) => (
        <Cell
          key={week.startDate}
          fill={week.inProgress ? 'transparent' : sportColor(sport)}
          stroke={week.inProgress ? sportColor(sport) : 'var(--surface)'}
          strokeWidth={week.inProgress ? 1.5 : 2}
        />
      ))}
    </Bar>
  ));
}
