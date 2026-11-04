'use client';

import type { ReactNode } from 'react';
import {
  addDays,
  dateLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@athlete-panel/ui';

export type LegendItem = { label: string; keyClass: string };

export const weekLabel = (week: { weekStart: string; inProgress: boolean }) =>
  `Week of ${dateLabel(week.weekStart)}${week.inProgress ? ' (in progress)' : ''}`;

export function periodText(weeks: { weekStart: string }[]) {
  return `from ${dateLabel(weeks[0]!.weekStart)} to ${dateLabel(addDays(weeks.at(-1)!.weekStart, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function ChartFigure({
  title,
  description,
  legend,
  loading,
  chart,
  headers,
  rows,
}: {
  title: string;
  description: string;
  legend: LegendItem[];
  loading: boolean;
  chart: ReactNode;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <figure className="charts-figure" aria-busy={loading} data-loading={loading}>
      <figcaption>
        <h2>{title}</h2>
        <p>{description}</p>
      </figcaption>
      <ul className="charts-legend" aria-label="Legend">
        {legend.map((item) => (
          <li key={item.label}>
            <span className={`charts-key ${item.keyClass}`} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
      {chart}
      <details className="charts-values">
        <summary>View values</summary>
        <div className="charts-values-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  {row.cells.map((cell, index) => (
                    <TableCell key={headers[index]}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </figure>
  );
}
