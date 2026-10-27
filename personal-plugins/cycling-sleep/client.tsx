'use client';

import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@athlete-panel/ui';
import { Bike, Moon } from 'lucide-react';
import { summarizeCyclingSleep } from './projection';
import {
  dateLabel,
  DateNavigation,
  duration,
  ExtensionSlot,
  MiniBars,
  PageHeader,
  Stat,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';

export default function CyclingSleepPage({ data }: PluginPageProps) {
  const { from, to } = useWorkspace();
  const summary = summarizeCyclingSleep(data, from, to);
  const { dates, dailySleep: sleep } = summary;
  const cycling = summary.dailyCycling.map((metric) => metric.value);
  return (
    <>
      <PageHeader
        eyebrow="PERSONAL PLUGIN"
        title="Cycling & sleep"
        description="See your riding volume alongside the sleep you recorded."
      />
      <div className="summary-strip">
        <Stat
          label="Cycling time"
          value={duration(summary.cycling.value)}
          hint={
            summary.cycling.missingCount
              ? `${summary.cycling.missingCount} sessions unknown`
              : undefined
          }
        />
        <Stat label="Average sleep" value={duration(summary.sleep.averageSeconds)} />
        <Stat label="Recorded nights" value={`${summary.sleep.recordedNights} / ${dates.length}`} />
        <DateNavigation />
      </div>
      <section className="section-block">
        <div className="section-heading">
          <h2>Week by week</h2>
          <span className="muted-text">Average of recorded nights</span>
        </div>
        <div className="coverage-scroll">
          <Table className="coverage-table">
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Cycling duration</TableHead>
                <TableHead>Average sleep</TableHead>
                <TableHead>Sleep coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.weeks.map((week) => (
                <TableRow key={week.startDate}>
                  <TableCell>
                    {dateLabel(week.startDate)} — {dateLabel(week.endDate)}
                  </TableCell>
                  <TableCell>
                    {duration(week.cycling.value)}
                    {week.cycling.missingCount > 0 && (
                      <small className="muted-text">
                        {' '}
                        · {week.cycling.missingCount} sessions unknown
                      </small>
                    )}
                  </TableCell>
                  <TableCell>{duration(week.sleep.averageSeconds)}</TableCell>
                  <TableCell>
                    {week.sleep.recordedNights} /{' '}
                    {week.sleep.recordedNights + week.sleep.missingNights} nights
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="chart-section">
        <div className="chart-section-title">
          <h2>
            <Bike
              size={18}
              style={{
                display: 'inline',
                verticalAlign: 'middle',
                marginRight: 9,
                color: 'var(--accent)',
              }}
            />
            Cycling duration
          </h2>
          <span className="muted-text">
            {dateLabel(from)} — {dateLabel(to)}
          </span>
        </div>
        <MiniBars
          values={cycling}
          labels={dates.map((date) => date.slice(-2))}
          formatter={duration}
        />
      </section>
      <section className="chart-section">
        <div className="chart-section-title">
          <h2>
            <Moon
              size={18}
              style={{
                display: 'inline',
                verticalAlign: 'middle',
                marginRight: 9,
                color: 'var(--accent)',
              }}
            />
            Sleep duration
          </h2>
          <span className="muted-text">Imported from Garmin</span>
        </div>
        <MiniBars
          values={sleep}
          labels={dates.map((date) => date.slice(-2))}
          formatter={duration}
          empty="Import sleep data from Garmin to see it alongside your rides."
        />
      </section>
      <p className="form-footnote">
        Read these records as context, not a recovery score. Unavailable sleep remains unknown. Link
        matching manual workouts and imported activities to keep volume totals accurate.
      </p>
      <ExtensionSlot kind="dashboard" />
    </>
  );
}
