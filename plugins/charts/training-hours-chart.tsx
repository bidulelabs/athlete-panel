'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import type { TrainingHoursWeek } from './training-hours';

const config = {
  recordedHours: { label: 'Recorded', color: 'var(--chart-recorded)' },
  plannedHours: { label: 'Planned', color: 'var(--muted)' },
} satisfies ChartConfig;

function TrainingHoursTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const week = payload?.[0]?.payload as TrainingHoursWeek | undefined;
  if (!active || !week) return null;
  return (
    <div className="charts-tooltip">
      <strong>
        Week of {dateLabel(week.weekStart)}
        {week.inProgress && ' (in progress)'}
      </strong>
      <dl>
        <div>
          <dt>Recorded</dt>
          <dd>{week.recordedLabel}</dd>
        </div>
        <div>
          <dt>Planned</dt>
          <dd>{week.plannedLabel}</dd>
        </div>
        {week.races.length > 0 && (
          <div>
            <dt>Race</dt>
            <dd>{week.races.join(', ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function TrainingHoursChart({ weeks }: { weeks: TrainingHoursWeek[] }) {
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
        <ChartTooltip cursor={{ fill: 'var(--hover)' }} content={<TrainingHoursTooltip />} />
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
        <Line
          dataKey="plannedHours"
          type="linear"
          stroke="var(--color-plannedHours)"
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
