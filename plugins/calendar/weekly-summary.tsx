'use client';

import { sportSelectionLabel } from '@athlete-panel/contracts';
import { useId, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Moon,
  Mountain,
  Timer,
  Footprints,
  Bike,
  HeartPulse,
  ArrowUpRight,
  AlertCircle,
  CalendarCheck,
  Activity,
} from 'lucide-react';
import {
  dateLabel,
  distance,
  duration,
  SportIcon,
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@athlete-panel/ui';
import {
  comparisonPercent,
  type MetricTotal,
  type TrainingSummary,
  type RecordedSession,
} from '../training/public/shared';
import type { WeeklySleep, WeeklyHrv } from './weekly-sleep';
import './weekly-summary.css';

type Format = (value: number) => string;
const compact = (metric: MetricTotal, format: Format) =>
  metric.knownCount === 0 || metric.value === null ? '—' : format(metric.value);
const noPlan = (metric: MetricTotal) => metric.missingCount === 0 && metric.value === 0;
const compactPlanned = (metric: MetricTotal, format: Format) =>
  metric.knownCount === 0 && noPlan(metric) ? 'No plan' : compact(metric, format);
function HeaderMetric({
  label,
  info,
  icon,
  partial = false,
  className = '',
  children,
}: {
  label: string;
  info: string;
  icon: ReactNode;
  partial?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setTip(false);
      }}
    >
      <Tooltip open={!open && tip} onOpenChange={setTip}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="unstyled"
              className={`week-header-metric ${className}`}
              aria-description={info}
            >
              <span className="sr-only">{label}: </span>
              {icon}
              <span className="week-header-value">{children}</span>
              {partial && <AlertCircle className="week-header-partial" aria-label="Missing data" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {label}: {info}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="week-metric-info" aria-label={`${label} information`}>
        <strong>{label}</strong>
        <p>{info}</p>
        {partial && <p>Some measurements are missing. Open the week’s details for coverage.</p>}
        <Button variant="link" onClick={() => setOpen(false)}>
          Close explanation
        </Button>
      </PopoverContent>
    </Popover>
  );
}
function HeaderComparison({
  label,
  icon,
  planned,
  actual,
  format,
  unit,
}: {
  label: string;
  icon: ReactNode;
  planned: MetricTotal;
  actual: MetricTotal;
  format: Format;
  unit: string;
}) {
  const missing = planned.missingCount + actual.missingCount;
  return (
    <HeaderMetric
      label={label}
      info={`Recorded / planned, ${unit}. ${actual.knownCount} recorded and ${planned.knownCount} planned measurements available.${missing ? ` ${missing} measurements missing.` : ''}`}
      icon={icon}
      partial={missing > 0}
    >
      <strong>{compact(actual, format)}</strong>
      <span> / {compactPlanned(planned, format)}</span>
    </HeaderMetric>
  );
}
function BandMetric({
  label,
  icon,
  value,
  hint,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  hint: ReactNode;
}) {
  return (
    <div className="week-band-metric">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function Measurement({
  metric,
  format,
  empty,
  label,
}: {
  metric: MetricTotal;
  format: Format;
  empty: string;
  label: string;
}) {
  const count = metric.knownCount + metric.missingCount;
  return (
    <div className="week-measurement">
      <strong>
        {count === 0
          ? empty
          : metric.value === null
            ? `${label} unavailable`
            : format(metric.value)}
      </strong>
      {metric.missingCount > 0 && (
        <small>
          {metric.value !== null ? 'Partial · ' : ''}
          {label} missing for {metric.missingCount} of {count} sessions
        </small>
      )}
    </div>
  );
}
function Comparison({
  label,
  planned,
  actual,
  format,
}: {
  label: string;
  planned: MetricTotal;
  actual: MetricTotal;
  format: Format;
}) {
  const percent = comparisonPercent(planned, actual);
  return (
    <div className="week-comparison" role="row">
      <div className="week-metric-name" role="rowheader">
        {label}
      </div>
      <div role="cell">
        <span className="week-cell-label">Recorded</span>
        <Measurement
          metric={actual}
          format={format}
          empty="No sessions recorded"
          label={label === 'Training duration' ? 'Duration' : 'Distance'}
        />
      </div>
      <div role="cell">
        <span className="week-cell-label">Planned</span>
        <Measurement
          metric={planned}
          format={format}
          empty="No planned volume"
          label={label === 'Training duration' ? 'Duration' : 'Distance'}
        />
      </div>
      <div className="week-comparison-note" role="cell">
        {percent !== null
          ? `${Math.round(percent)}% of planned volume`
          : noPlan(planned)
            ? 'No planned volume'
            : planned.missingCount || actual.missingCount
              ? 'Comparison unavailable · incomplete data'
              : 'No sessions recorded'}
      </div>
    </div>
  );
}
function NightCoverage({ coverage }: { coverage: Omit<WeeklySleep, 'averageSeconds'> }) {
  return (
    <>
      {coverage.elapsedNights > 0 && (
        <p>
          {coverage.recordedNights} of {coverage.elapsedNights} nights recorded
          {coverage.missingNights > 0 && ` · ${coverage.missingNights} unavailable`}
        </p>
      )}
      {coverage.upcomingNights > 0 && (
        <p>
          {coverage.upcomingNights} upcoming {coverage.upcomingNights === 1 ? 'night' : 'nights'}
        </p>
      )}
      {coverage.ambiguousNights > 0 && (
        <p className="week-context-caption">
          {coverage.ambiguousNights} {coverage.ambiguousNights === 1 ? 'night has' : 'nights have'}{' '}
          overlapping source accounts and {coverage.ambiguousNights === 1 ? 'is' : 'are'} excluded.
        </p>
      )}
    </>
  );
}

export function WeeklySummary({
  summary,
  sleep,
  hrv,
  units,
  today,
  onSession,
}: {
  summary: TrainingSummary;
  sleep: WeeklySleep;
  hrv: WeeklyHrv;
  units: 'metric' | 'imperial';
  today: string;
  onSession: (session: RecordedSession) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const regionId = useId(),
    buttonId = useId();
  const dates = `${dateLabel(summary.startDate)} — ${dateLabel(summary.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const shortDates = `${dateLabel(summary.startDate, { day: 'numeric', month: 'short', ...(summary.startDate.slice(0, 4) !== summary.endDate.slice(0, 4) ? { year: 'numeric' } : {}) })} – ${dateLabel(summary.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const current = summary.startDate <= today && summary.endDate >= today;
  const distanceFormat: Format = (value) => distance(value, units);
  const elevationFormat: Format = (value) =>
    `${Math.round(value * (units === 'imperial' ? 3.28084 : 1)).toLocaleString('en-GB')} ${units === 'imperial' ? 'ft' : 'm'}`;
  const preview = summary.recordedSessions.slice(0, 6);
  return (
    <Collapsible
      open={expanded}
      onOpenChange={(value) => {
        setExpanded(value);
        if (!value) setDetails(false);
      }}
      className={`weekly-summary${current ? ' is-current-week' : ''}`}
    >
      <div className="week-summary-header">
        <div className="week-summary-date">
          <span>{shortDates}</span>
          {current && <span className="week-current-label">This week</span>}
        </div>
        <div className="week-header-metrics">
          <HeaderComparison
            label="Duration"
            unit="hours and minutes"
            icon={<Timer aria-hidden="true" />}
            planned={summary.planned.durationSeconds}
            actual={summary.actual.durationSeconds}
            format={duration}
          />
          <HeaderComparison
            label="Running distance"
            unit={units === 'imperial' ? 'miles' : 'kilometres'}
            icon={<Footprints aria-hidden="true" />}
            planned={summary.planned.distanceMeters.running}
            actual={summary.actual.distanceMeters.running}
            format={distanceFormat}
          />
          <HeaderComparison
            label="Cycling distance"
            unit={units === 'imperial' ? 'miles' : 'kilometres'}
            icon={<Bike aria-hidden="true" />}
            planned={summary.planned.distanceMeters.cycling}
            actual={summary.actual.distanceMeters.cycling}
            format={distanceFormat}
          />
          <HeaderMetric
            label="Recorded elevation"
            info={`Running then cycling gain, ${units === 'imperial' ? 'feet' : 'metres'}. Recorded only. Running: ${summary.actual.elevationMeters.running.knownCount} of ${summary.actual.elevationMeters.running.knownCount + summary.actual.elevationMeters.running.missingCount} sessions measured; cycling: ${summary.actual.elevationMeters.cycling.knownCount} of ${summary.actual.elevationMeters.cycling.knownCount + summary.actual.elevationMeters.cycling.missingCount}. Manual completions do not record elevation.`}
            icon={<Mountain aria-hidden="true" />}
            partial={
              summary.actual.elevationMeters.running.missingCount +
                summary.actual.elevationMeters.cycling.missingCount >
              0
            }
          >
            <span>Run </span>
            <strong>{compact(summary.actual.elevationMeters.running, elevationFormat)}</strong>
            <span> · Ride </span>
            <strong>{compact(summary.actual.elevationMeters.cycling, elevationFormat)}</strong>
          </HeaderMetric>
          <HeaderMetric
            label="Average sleep"
            info={`Average of recorded nights, hours and minutes. ${sleep.recordedNights} of ${sleep.elapsedNights} elapsed nights recorded; ${sleep.upcomingNights} upcoming.${sleep.ambiguousNights ? ` ${sleep.ambiguousNights} overlapping-source nights excluded.` : ''}`}
            icon={<Moon aria-hidden="true" />}
            partial={sleep.missingNights > 0}
          >
            <strong>
              {sleep.elapsedNights === 0
                ? 'Upcoming'
                : sleep.averageSeconds === null
                  ? '—'
                  : duration(sleep.averageSeconds)}
            </strong>
          </HeaderMetric>
        </div>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            id={buttonId}
            className="week-summary-toggle"
            aria-controls={regionId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} summary for ${dates}`}
          >
            <ChevronDown size={16} className="week-summary-chevron" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent
        id={regionId}
        role="region"
        aria-labelledby={buttonId}
        className="week-summary-body"
      >
        <div className="week-metric-band">
          <BandMetric
            label="Duration"
            icon={<Timer />}
            value={compact(summary.actual.durationSeconds, duration)}
            hint={`Planned: ${compactPlanned(summary.planned.durationSeconds, duration)}`}
          />
          <BandMetric
            label="Running distance"
            icon={<Footprints />}
            value={compact(summary.actual.distanceMeters.running, distanceFormat)}
            hint={`Planned: ${compactPlanned(summary.planned.distanceMeters.running, distanceFormat)}`}
          />
          <BandMetric
            label="Cycling distance"
            icon={<Bike />}
            value={compact(summary.actual.distanceMeters.cycling, distanceFormat)}
            hint={`Planned: ${compactPlanned(summary.planned.distanceMeters.cycling, distanceFormat)}`}
          />
          <BandMetric
            label="Recorded elevation"
            icon={<Mountain />}
            value={
              <>
                <span>Run {compact(summary.actual.elevationMeters.running, elevationFormat)}</span>
                <span>Ride {compact(summary.actual.elevationMeters.cycling, elevationFormat)}</span>
              </>
            }
            hint="Recorded gain"
          />
          <BandMetric
            label="Planned sessions"
            icon={<CalendarCheck />}
            value={summary.planned.sessions}
            hint="By scheduled date"
          />
          <BandMetric
            label="Recorded sessions"
            icon={<Activity />}
            value={summary.actual.sessions}
            hint="Linked activities counted once"
          />
          <BandMetric
            label="Average sleep"
            icon={<Moon />}
            value={
              sleep.elapsedNights === 0
                ? 'Upcoming'
                : sleep.averageSeconds === null
                  ? '—'
                  : duration(sleep.averageSeconds)
            }
            hint={`${sleep.recordedNights} of ${sleep.elapsedNights} nights recorded`}
          />
          <BandMetric
            label="Recorded HRV"
            icon={<HeartPulse />}
            value={
              hrv.elapsedNights === 0
                ? 'Upcoming'
                : hrv.averageMilliseconds === null
                  ? '—'
                  : `${Math.round(hrv.averageMilliseconds)} ms`
            }
            hint={`${hrv.recordedNights} of ${hrv.elapsedNights} nights recorded`}
          />
        </div>
        <p className="week-summary-legend">Recorded / planned · totals from available records</p>
        <Collapsible open={details} onOpenChange={setDetails}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="week-details-toggle">
              {details ? 'Hide details' : 'Show details'}
              <ChevronDown size={14} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="week-summary-details">
            <div
              role="table"
              aria-label="Planned and recorded training"
              className="week-comparison-table"
            >
              <div role="row" className="week-comparison week-comparison-head">
                <span role="columnheader">Training volume</span>
                <span role="columnheader">Recorded</span>
                <span role="columnheader">Planned</span>
                <span role="columnheader">Comparison</span>
              </div>
              <Comparison
                label="Training duration"
                planned={summary.planned.durationSeconds}
                actual={summary.actual.durationSeconds}
                format={duration}
              />
              <Comparison
                label="Running distance"
                planned={summary.planned.distanceMeters.running}
                actual={summary.actual.distanceMeters.running}
                format={distanceFormat}
              />
              <Comparison
                label="Cycling distance"
                planned={summary.planned.distanceMeters.cycling}
                actual={summary.actual.distanceMeters.cycling}
                format={distanceFormat}
              />
            </div>
            <section className="week-sport-breakdown" aria-label="Sport group and subgroup summary">
              <h3>By sport</h3>
              <p className="week-context-caption">
                Group totals include their subgroups. Recorded / planned; missing measurements stay
                explicit.
              </p>
              <div className="sport-breakdown-scroll">
                <table aria-label="Training by Garmin group and subgroup">
                  <thead>
                    <tr>
                      <th>Sport</th>
                      <th>Sessions</th>
                      <th>Duration</th>
                      <th>Distance</th>
                      <th>Elevation gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sportBreakdown.map((row) => (
                      <tr key={`${row.sport}:${row.sportSubgroup ?? ''}:${row.sportResolution}`}>
                        <th scope="row">{sportSelectionLabel(row)}</th>
                        <td>
                          {row.actual.sessions} / {row.planned.sessions}
                        </td>
                        <td>
                          <Measurement
                            empty="0"
                            metric={row.actual.durationSeconds}
                            format={duration}
                            label="Recorded duration"
                          />{' '}
                          /{' '}
                          <Measurement
                            empty="0"
                            metric={row.planned.durationSeconds}
                            format={duration}
                            label="Planned duration"
                          />
                        </td>
                        <td>
                          <Measurement
                            empty="0"
                            metric={row.actual.distanceMeters}
                            format={distanceFormat}
                            label="Recorded distance"
                          />{' '}
                          /{' '}
                          <Measurement
                            empty="0"
                            metric={row.planned.distanceMeters}
                            format={distanceFormat}
                            label="Planned distance"
                          />
                        </td>
                        <td>
                          <Measurement
                            empty="0"
                            metric={row.actual.elevationMeters}
                            format={elevationFormat}
                            label="Recorded elevation"
                          />{' '}
                          /{' '}
                          <Measurement
                            empty="0"
                            metric={row.planned.elevationMeters}
                            format={elevationFormat}
                            label="Planned elevation"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="week-plan-status" aria-label="Planned-session status">
              <div>
                <h3>Planned sessions</h3>
                <p className="week-context-caption">By scheduled date</p>
              </div>
              <dl>
                {(['completed', 'partial', 'skipped', 'pending'] as const).map((status) => (
                  <div key={status}>
                    <dt>{status[0]!.toUpperCase() + status.slice(1)}</dt>
                    <dd>{summary.plannedStatus[status]}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <div className="week-recorded-context">
              <section className="week-elevation" aria-label="Recorded elevation gain">
                <h3>
                  <Mountain size={16} aria-hidden="true" />
                  Elevation gain
                </h3>
                <p className="week-context-caption">Recorded running and cycling</p>
                <dl>
                  <div>
                    <dt>Running</dt>
                    <dd>
                      <Measurement
                        metric={summary.actual.elevationMeters.running}
                        format={elevationFormat}
                        empty="No runs recorded"
                        label="Elevation"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Cycling</dt>
                    <dd>
                      <Measurement
                        metric={summary.actual.elevationMeters.cycling}
                        format={elevationFormat}
                        empty="No rides recorded"
                        label="Elevation"
                      />
                    </dd>
                  </div>
                </dl>
                {summary.actual.elevationMeters.running.missingCount +
                  summary.actual.elevationMeters.cycling.missingCount >
                  0 && (
                  <p className="week-context-caption">
                    Manual completions do not record elevation.
                  </p>
                )}
              </section>
              <section className="week-nightly week-sleep" aria-label="Recorded sleep">
                <h3>
                  <Moon size={16} aria-hidden="true" />
                  Recorded sleep
                </h3>
                <p className="week-context-caption">Average of recorded nights</p>
                <strong className="week-nightly-value">
                  {sleep.elapsedNights === 0
                    ? 'Upcoming'
                    : sleep.averageSeconds === null
                      ? 'Sleep duration unavailable'
                      : duration(sleep.averageSeconds)}
                </strong>
                <NightCoverage coverage={sleep} />
              </section>
              <section className="week-nightly week-hrv" aria-label="Recorded HRV">
                <h3>
                  <HeartPulse size={16} aria-hidden="true" />
                  Recorded HRV
                </h3>
                <p className="week-context-caption">Average of recorded nights</p>
                <strong className="week-nightly-value">
                  {hrv.elapsedNights === 0
                    ? 'Upcoming'
                    : hrv.averageMilliseconds === null
                      ? 'HRV unavailable'
                      : `${Math.round(hrv.averageMilliseconds)} ms`}
                </strong>
                <NightCoverage coverage={hrv} />
              </section>
            </div>
            <section className="week-session-preview" aria-label="Recorded sessions">
              <div className="week-section-heading">
                <h3>Recorded sessions</h3>
                <span>{summary.actual.sessions} total</span>
              </div>
              {preview.length ? (
                <ul>
                  {preview.map((session) => (
                    <li key={`${session.kind}:${session.id}`}>
                      <Button
                        variant="unstyled"
                        type="button"
                        aria-label={`View recorded session ${session.title}`}
                        onClick={() => onSession(session)}
                      >
                        <SportIcon sport={session.sport} size={17} />
                        <span className="week-session-name">
                          <strong>{session.title}</strong>
                          <small>
                            {dateLabel(session.localDate, {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            })}{' '}
                            · {session.kind === 'activity' ? 'Garmin' : 'Manual'}
                          </small>
                        </span>
                        <span className="week-session-duration">
                          {duration(session.durationSeconds)}
                        </span>
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="week-context-caption">No sessions recorded.</p>
              )}
              {summary.recordedSessions.length > preview.length && (
                <p className="week-context-caption">
                  +{summary.recordedSessions.length - preview.length} more sessions in this week’s
                  calendar
                </p>
              )}
            </section>
            <p className="week-summary-footnote">
              Recorded training includes partial and unplanned sessions. Linked activities count
              once. Totals describe available records; missing imports may affect this week.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CollapsibleContent>
      {summary.possibleDuplicateWorkoutIds.length > 0 && (
        <div className="week-summary-warning">
          Some manual completions may match imported activities. Link them to reconcile this week’s
          totals.
        </div>
      )}
    </Collapsible>
  );
}
