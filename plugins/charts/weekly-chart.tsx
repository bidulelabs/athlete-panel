'use client';

import type { ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import { weekLabel } from './chart-figure';
import type { TrainingHoursWeek } from './training-hours';

type TooltipRows<Week> = (week: Week) => [label: string, value: string][];

function WeekTooltip<Week extends TrainingHoursWeek>({
  active,
  payload,
  rows,
}: Partial<TooltipContentProps<number, string>> & { rows: TooltipRows<Week> }) {
  const week = payload?.[0]?.payload as Week | undefined;
  if (!active || !week) return null;
  return (
    <div className="charts-tooltip">
      <strong>{weekLabel(week)}</strong>
      <dl>
        {[...rows(week), ...(week.races.length ? [['Race', week.races.join(', ')]] : [])].map(
          ([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}

export function WeeklyChart<Week extends TrainingHoursWeek>({
  weeks,
  config,
  tooltipRows,
  children,
}: {
  weeks: Week[];
  config: ChartConfig;
  tooltipRows: TooltipRows<Week>;
  children: ReactNode;
}) {
  return (
    <ChartContainer config={config} className="charts-plot">
      <ComposedChart data={weeks} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey="weekStart"
          tickFormatter={(weekStart: string) => dateLabel(weekStart)}
          tickLine={false}
          axisLine={{ stroke: 'var(--line)' }}
          interval="preserveStartEnd"
          minTickGap={16}
        />
        <YAxis
          width="auto"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickCount={5}
          label={{ value: 'Hours', position: 'top', offset: 16 }}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--hover)' }}
          content={<WeekTooltip rows={tooltipRows} />}
        />
        {weeks
          .filter((week) => week.races.length > 0)
          .map((week) => (
            <ReferenceLine
              key={week.weekStart}
              x={week.weekStart}
              stroke="var(--chart-race)"
              strokeWidth={1.5}
              label={{
                value: week.races.join(', '),
                position: 'insideTopRight',
                className: 'charts-race-label',
              }}
            />
          ))}
        {children}
        <Line
          dataKey="plannedHours"
          type="linear"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeDasharray="4 4"
          connectNulls={false}
          dot={{ r: 4, fill: 'var(--surface)', strokeDasharray: '' }}
          activeDot={{ r: 5, fill: 'var(--surface)' }}
          animationDuration={180}
          animationEasing="ease"
        />
      </ComposedChart>
    </ChartContainer>
  );
}
