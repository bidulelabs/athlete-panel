'use client';

import type { ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import { bucketLabel } from './chart-figure';
import type { TrainingHoursBucket } from './training-hours';

type TooltipRows<Week> = (week: Week) => [label: string, value: string][];

function WeekTooltip<Week extends TrainingHoursBucket>({
  active,
  payload,
  rows,
}: Partial<TooltipContentProps<number, string>> & { rows: TooltipRows<Week> }) {
  const week = payload?.[0]?.payload as Week | undefined;
  if (!active || !week) return null;
  return (
    <div className="charts-tooltip">
      <strong>{bucketLabel(week)}</strong>
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

export function GroupedChart<Week extends TrainingHoursBucket>({
  weeks,
  yLabel,
  planned,
  config,
  tooltipRows,
  children,
}: {
  weeks: Week[];
  yLabel: string;
  planned: boolean;
  config: ChartConfig;
  tooltipRows: TooltipRows<Week>;
  children: ReactNode;
}) {
  return (
    <ChartContainer config={config} className="charts-plot">
      <ComposedChart data={weeks} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey="startDate"
          tickFormatter={(startDate: string) =>
            dateLabel(
              startDate,
              weeks[0]?.grouping === 'month' ? { month: 'short', year: 'numeric' } : undefined,
            )
          }
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
          label={{ value: yLabel, position: 'top', offset: 16 }}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--hover)' }}
          content={<WeekTooltip rows={tooltipRows} />}
        />
        {weeks
          .filter((week) => week.races.length > 0)
          .map((week) => (
            <ReferenceLine
              key={week.startDate}
              x={week.startDate}
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
        {planned && (
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
        )}
      </ComposedChart>
    </ChartContainer>
  );
}
