'use client';

import type { ChartsGrouping } from '@athlete-panel/contracts';
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

export const groupingLabels = {
  day: { title: 'Daily', column: 'Day' },
  week: { title: 'Weekly', column: 'Week' },
  month: { title: 'Monthly', column: 'Month' },
};

export function bucketLabel(bucket: {
  startDate: string;
  grouping: ChartsGrouping;
  inProgress: boolean;
  partial: boolean;
}) {
  const label =
    bucket.grouping === 'month'
      ? dateLabel(bucket.startDate, { month: 'long', year: 'numeric' })
      : `${bucket.grouping === 'week' ? 'Week of ' : ''}${dateLabel(bucket.startDate)}`;
  return `${label}${bucket.partial ? ' (partial)' : ''}${bucket.inProgress ? ' (in progress)' : ''}`;
}

export function periodText(
  periods: ({ weekStart: string } | { startDate: string; endDate: string })[],
) {
  const first = periods[0]!,
    last = periods.at(-1)!;
  const from = 'startDate' in first ? first.startDate : first.weekStart;
  const to = 'endDate' in last ? last.endDate : addDays(last.weekStart, 6);
  return `from ${dateLabel(from)} to ${dateLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
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
