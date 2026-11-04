'use client';

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import type { NightRow } from './resting-heart-rate-hrv';

function NightTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const night = payload?.[0]?.payload as NightRow | undefined;
  if (!active || !night) return null;
  return (
    <div className="charts-tooltip">
      <strong>Night of {dateLabel(night.date)}</strong>
      <dl>
        {[
          ['Night', night.valueLabel],
          ['7-day average', night.averageLabel],
          ['Usual range', night.usualRangeLabel],
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

export default function NightlyChart({ rows, unit }: { rows: NightRow[]; unit: string }) {
  return (
    <ChartContainer config={{}} className="charts-plot">
      <ComposedChart data={rows} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
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
          domain={['auto', 'auto']}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickCount={5}
          label={{ value: unit, position: 'top', offset: 16 }}
        />
        <ChartTooltip cursor={{ stroke: 'var(--line)' }} content={<NightTooltip />} />
        <Area
          dataKey="usualRange"
          stroke="none"
          fill="var(--chart-recorded)"
          fillOpacity={0.14}
          connectNulls={false}
          activeDot={false}
          animationDuration={180}
          animationEasing="ease"
        />
        <Line
          dataKey="value"
          stroke="none"
          dot={{ r: 4, fill: 'var(--muted)', stroke: 'var(--surface)', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: 'var(--muted)', stroke: 'var(--surface)', strokeWidth: 2 }}
          animationDuration={180}
          animationEasing="ease"
        />
        <Line
          dataKey="average"
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
