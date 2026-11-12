'use client';

import { useId, useMemo, type PointerEvent } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@athlete-panel/ui/components/chart';
import { distance } from '@athlete-panel/ui';
import type { TrackAnalysis } from '@athlete-panel/contracts';
import { elevationLabel, routeCoordinates, slopeBands, slopeColor } from './presentation';

type FigureProps = {
  track: TrackAnalysis;
  selected: number;
  onSelect: (index: number) => void;
  units: string;
};
export function CourseRoute({ track, selected, onSelect }: FigureProps) {
  const coordinates = useMemo(() => routeCoordinates(track.points), [track.points]);
  const chosen = coordinates[selected] ?? coordinates[0]!;
  const first = coordinates[0]!,
    last = coordinates.at(-1)!;
  const selectPoint = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 320,
      y = ((event.clientY - rect.top) / rect.height) * 320;
    let best = 0,
      bestDistance = Infinity;
    coordinates.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    onSelect(best);
  };
  return (
    <figure className="race-route">
      <figcaption>
        <span>Course route</span>
        <span>No base map</span>
      </figcaption>
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label="Course route. Use the course-position slider to select a point."
        onPointerMove={selectPoint}
        onPointerDown={selectPoint}
      >
        <title>Course route without a base map</title>
        {coordinates.slice(1).map((p, offset) => {
          const previous = coordinates[offset]!,
            point = track.points[offset + 1]!;
          return point.segment === track.points[offset]!.segment ? (
            <line
              key={offset}
              x1={previous.x}
              y1={previous.y}
              x2={p.x}
              y2={p.y}
              stroke={slopeColor(point.slopePercent)}
              strokeWidth="4"
              strokeLinecap="round"
            />
          ) : null;
        })}
        <circle
          cx={first.x}
          cy={first.y}
          r="6"
          fill="var(--surface)"
          stroke="var(--text)"
          strokeWidth="2"
        />
        <text x={first.x} y={first.y - 12} textAnchor="middle">
          Start
        </text>
        <rect
          x={last.x - 4}
          y={last.y - 4}
          width="8"
          height="8"
          fill="var(--text)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
        <text x={last.x} y={last.y + 19} textAnchor="middle">
          Finish
        </text>
        <circle
          data-testid="route-selection"
          cx={chosen.x}
          cy={chosen.y}
          r="7"
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth="3"
        />
      </svg>
    </figure>
  );
}
export function ElevationProfile({ track, selected, onSelect, units }: FigureProps) {
  const id = useId().replace(/:/g, '');
  const profilePoints = useMemo(
    () =>
      track.points.flatMap((point, index) =>
        index > 0 && point.segment !== track.points[index - 1]!.segment
          ? [{ ...point, elevationMeters: null }, point]
          : [point],
      ),
    [track.points],
  );
  const point = track.points[selected] ?? track.points[0]!;
  const heights = track.points.flatMap((p) =>
    p.elevationMeters === null ? [] : [p.elevationMeters],
  );
  const minimum = heights.length ? Math.floor(Math.min(...heights) / 100) * 100 : 0;
  const maximum = heights.length
    ? Math.max(minimum + 100, Math.ceil(Math.max(...heights) / 100) * 100)
    : 100;
  const nearest = (value: number) => {
    let best = 0;
    track.points.forEach((p, i) => {
      if (Math.abs(p.distanceMeters - value) < Math.abs(track.points[best]!.distanceMeters - value))
        best = i;
    });
    onSelect(best);
  };
  return (
    <section className="race-profile" aria-labelledby="race-profile-heading">
      <div className="race-section-heading">
        <h2 id="race-profile-heading">Elevation profile</h2>
        <output data-testid="profile-selection">
          {distance(point.distanceMeters, units)} · {elevationLabel(point.elevationMeters, units)} ·{' '}
          {point.slopePercent === null
            ? 'Slope unknown'
            : `${point.slopePercent > 0 ? '+' : ''}${point.slopePercent.toFixed(1)}%`}
        </output>
      </div>
      {heights.length ? (
        <ChartContainer
          config={{ elevationMeters: { label: 'Elevation', color: 'var(--race-flat)' } }}
          className="race-elevation-chart"
        >
          <AreaChart
            data={profilePoints}
            accessibilityLayer={false}
            margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
            onMouseMove={(event) => {
              if (event.activeLabel !== undefined) nearest(Number(event.activeLabel));
            }}
            onClick={(event) => {
              if (event.activeLabel !== undefined) nearest(Number(event.activeLabel));
            }}
          >
            <defs>
              <linearGradient id={`race-gradient-${id}`} x1="0" y1="0" x2="1" y2="0">
                {track.points.flatMap((p, i) => {
                  const start = i
                    ? (track.points[i - 1]!.distanceMeters + p.distanceMeters) / 2
                    : 0;
                  const end =
                    i < track.points.length - 1
                      ? (track.points[i + 1]!.distanceMeters + p.distanceMeters) / 2
                      : track.distanceMeters;
                  return [
                    <stop
                      key={`${i}a`}
                      offset={`${(start / track.distanceMeters) * 100}%`}
                      stopColor={slopeColor(p.slopePercent)}
                    />,
                    <stop
                      key={`${i}b`}
                      offset={`${(end / track.distanceMeters) * 100}%`}
                      stopColor={slopeColor(p.slopePercent)}
                    />,
                  ];
                })}
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <XAxis
              dataKey="distanceMeters"
              type="number"
              domain={[0, track.distanceMeters]}
              tickFormatter={(value) =>
                `${(Number(value) / (units === 'imperial' ? 1609.344 : 1000)).toFixed(0)} ${units === 'imperial' ? 'mi' : 'km'}`
              }
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
            />
            <YAxis
              domain={[minimum, maximum]}
              width={65}
              tickFormatter={(value) => elevationLabel(Number(value), units)}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
            />
            <Tooltip content={() => null} cursor={false} />
            <Area
              dataKey="elevationMeters"
              type="linear"
              baseValue={minimum}
              stroke={
                heights.every((height) => height === heights[0])
                  ? 'var(--race-flat)'
                  : `url(#race-gradient-${id})`
              }
              strokeWidth={1.5}
              fill={`url(#race-gradient-${id})`}
              fillOpacity={0.94}
              connectNulls={false}
              isAnimationActive={false}
            />
            <ReferenceLine x={point.distanceMeters} stroke="var(--text)" strokeDasharray="3 3" />
            {point.elevationMeters !== null && (
              <ReferenceDot
                x={point.distanceMeters}
                y={point.elevationMeters}
                r={4}
                stroke="var(--surface)"
                fill="var(--text)"
              />
            )}
          </AreaChart>
        </ChartContainer>
      ) : (
        <p className="race-missing-profile">
          No elevation in this file. Upload a course with elevation to see its profile.
        </p>
      )}
      <label className="race-position">
        <span>Course position</span>
        <input
          aria-label="Course position"
          aria-valuetext={`${distance(point.distanceMeters, units)}, elevation ${elevationLabel(point.elevationMeters, units)}`}
          type="range"
          min="0"
          max={track.points.length - 1}
          value={selected}
          onChange={(event) => onSelect(Number(event.target.value))}
        />
      </label>
      <ul className="race-slope-legend" aria-label="Slope bands">
        {slopeBands.map((band) => (
          <li key={band.key}>
            <i style={{ background: `var(--race-${band.key})` }} />
            <span>
              {band.name}
              <small>{band.range}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="race-hint">
        Move over the route or profile, or use the slider with the arrow keys. Colour shows slope,
        not trail difficulty.
      </p>
    </section>
  );
}
