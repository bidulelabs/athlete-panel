'use client';

import type { Key } from 'react';
import { Line } from 'recharts';
import { climbUnitLabel, type UnitSystem, type ClimbingWeek } from './weekly-climbing';
import { WeeklyChart } from './weekly-chart';

type ClimbDotProps = { key?: Key | null; cx?: number; cy?: number; payload: ClimbingWeek };

export default function RunningClimbChart({
  weeks,
  units,
}: {
  weeks: ClimbingWeek[];
  units: UnitSystem;
}) {
  return (
    <WeeklyChart
      weeks={weeks}
      yLabel={climbUnitLabel(units)}
      planned={false}
      config={{}}
      tooltipRows={(week) => [['Running climb', week.runningClimbLabel]]}
    >
      <Line
        dataKey="runningClimb"
        type="linear"
        stroke="var(--chart-running)"
        strokeWidth={2}
        connectNulls={false}
        dot={({ key, cx, cy, payload }: ClimbDotProps) =>
          payload.runningClimb === null ? (
            <g key={key} />
          ) : (
            <circle
              key={key}
              cx={cx}
              cy={cy}
              r={4}
              fill={payload.inProgress ? 'var(--surface)' : 'var(--chart-running)'}
              stroke={payload.inProgress ? 'var(--chart-running)' : 'var(--surface)'}
              strokeWidth={2}
            />
          )
        }
        activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
        animationDuration={180}
        animationEasing="ease"
      />
    </WeeklyChart>
  );
}
