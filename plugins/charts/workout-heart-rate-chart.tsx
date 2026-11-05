'use client';

import type { ChartsSport } from '@athlete-panel/contracts';
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { ChartContainer, ChartTooltip } from '@athlete-panel/ui/components/chart';
import { dateLabel } from '@athlete-panel/ui';
import { sportColor } from './sport-bars';
import type { HeartRateSession } from './workout-heart-rate';

function HeartRateTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const session = payload?.[0]?.payload as HeartRateSession | undefined;
  if (!active || !session) return null;
  return (
    <div className="charts-tooltip">
      <strong>{session.title}</strong>
      <dl>
        {[
          ['Date', dateLabel(session.date)],
          ['Average heart rate', session.heartRateLabel],
          ['Duration', session.durationLabel],
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

const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`);

export default function WorkoutHeartRateChart({
  sessions,
  sport,
  from,
  to,
}: {
  sessions: HeartRateSession[];
  sport: ChartsSport;
  from: string;
  to: string;
}) {
  return (
    <ChartContainer config={{}} className="charts-plot">
      <ScatterChart margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          type="number"
          dataKey="time"
          scale="time"
          domain={[dayStart(from), dayStart(to) + 86400000]}
          tickFormatter={(time: number) => dateLabel(new Date(time).toISOString().slice(0, 10))}
          tickLine={false}
          axisLine={{ stroke: 'var(--line)' }}
          minTickGap={16}
        />
        <YAxis
          type="number"
          dataKey="averageHeartRateBpm"
          domain={[
            (lowest: number) => Math.floor((lowest - 5) / 10) * 10,
            (highest: number) => Math.ceil((highest + 5) / 10) * 10,
          ]}
          width="auto"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          label={{ value: 'bpm', position: 'top', offset: 16 }}
        />
        <ZAxis range={[110, 110]} />
        <ChartTooltip cursor={false} content={<HeartRateTooltip />} />
        <Scatter
          data={sessions.filter((session) => session.averageHeartRateBpm !== null)}
          fill={sportColor(sport)}
          stroke="var(--surface)"
          strokeWidth={2}
          animationDuration={180}
          animationEasing="ease"
        />
      </ScatterChart>
    </ChartContainer>
  );
}
