'use client';

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import type { LoadDay } from './training-load';

function LoadTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const day = payload?.[0]?.payload as LoadDay | undefined;
  if (!active || !day) return null;
  return (
    <div className="charts-tooltip">
      <strong>{dateLabel(day.date)}</strong>
      <dl>
        {[
          ['Load', day.loadLabel],
          ['7-day average', day.shortAverageLabel],
          ['42-day average', day.longAverageLabel],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function TrainingLoadChart({ days }: { days: LoadDay[] }) {
  return (
    <ChartContainer config={{}} className="charts-plot">
      <ComposedChart data={days} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey="date"
          tickFormatter={(date: string) => dateLabel(date)}
          tickLine={false}
          axisLine={{ stroke: 'var(--line)' }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          width="auto"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickCount={5}
          label={{ value: 'TRIMP', position: 'top', offset: 16 }}
        />
        <ChartTooltip cursor={{ fill: 'var(--line)', opacity: 0.4 }} content={<LoadTooltip />} />
        <Bar
          dataKey="load"
          fill="var(--chart-load)"
          radius={[4, 4, 0, 0]}
          maxBarSize={14}
          animationDuration={180}
          animationEasing="ease"
        />
        <Line
          dataKey="longAverage"
          type="monotone"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          activeDot={false}
          connectNulls={false}
          animationDuration={180}
          animationEasing="ease"
        />
        <Line
          dataKey="shortAverage"
          type="monotone"
          stroke="var(--chart-recorded)"
          strokeWidth={2}
          dot={false}
          activeDot={false}
          connectNulls={false}
          animationDuration={180}
          animationEasing="ease"
        />
      </ComposedChart>
    </ChartContainer>
  );
}
