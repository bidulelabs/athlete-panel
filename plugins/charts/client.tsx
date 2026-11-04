'use client';

import {
  chartsMaxWeeks,
  type ChartsSummary,
  type ChartsSummaryInput,
} from '@athlete-panel/contracts';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ChartColumn, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  Button,
  dateLabel,
  duration,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  localDate,
  NativeSelect,
  PageHeader,
  startOfWeek,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { hasSessions, trainingHoursWeeks, type TrainingHoursWeek } from './training-hours';
import './charts.css';

const TrainingHoursChart = lazy(() => import('./training-hours-chart'));

const templates = [
  {
    id: 'training-hours',
    title: 'Training hours',
    description: 'Compare planned and recorded hours, with your races.',
  },
] as const;
type TemplateId = (typeof templates)[number]['id'];
const periods = {
  '4': 'Last 4 weeks',
  '12': 'Last 12 weeks',
  '52': 'Last 52 weeks',
  custom: 'Custom dates',
} as const;
type Period = keyof typeof periods;

const weekCount = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000)) + 1;

export default function ChartsPage({ data, request }: PluginPageProps) {
  const [template, setTemplate] = useState<TemplateId | null>(null);
  return template ? (
    <TrainingHoursTemplate
      today={localDate(new Date(), data.profile?.timezone)}
      request={request}
      onBack={() => setTemplate(null)}
    />
  ) : (
    <>
      <PageHeader
        title="Charts"
        description="Start with a familiar chart, then adjust the dates."
      />
      <ul className="charts-templates" aria-label="Chart templates">
        {templates.map((item) => (
          <li key={item.id}>
            <Button
              variant="unstyled"
              className="charts-template"
              onClick={() => setTemplate(item.id)}
            >
              <span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function TrainingHoursTemplate({
  today,
  request,
  onBack,
}: {
  today: string;
  request: PluginPageProps['request'];
  onBack: () => void;
}) {
  const { weekStartsOn } = useWorkspace();
  const currentWeek = startOfWeek(today, weekStartsOn);
  const [period, setPeriod] = useState<Period>('12');
  const [customFrom, setCustomFrom] = useState(addDays(currentWeek, -7 * 11));
  const [customTo, setCustomTo] = useState(today);
  const [summary, setSummary] = useState<ChartsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selection: ChartsSummaryInput | string = useMemo(() => {
    if (period !== 'custom')
      return { weekStart: addDays(currentWeek, -7 * (Number(period) - 1)), weeks: Number(period) };
    if (!customFrom || !customTo || customTo < customFrom)
      return 'Choose an end date on or after the start date.';
    const weekStart = startOfWeek(customFrom, weekStartsOn);
    const weeks = weekCount(weekStart, startOfWeek(customTo, weekStartsOn));
    return weeks > chartsMaxWeeks
      ? `Choose a period of at most ${chartsMaxWeeks} weeks.`
      : { weekStart, weeks };
  }, [period, currentWeek, customFrom, customTo, weekStartsOn]);
  useEffect(() => {
    if (typeof selection === 'string') return;
    let current = true;
    setLoading(true);
    setError(null);
    request('charts', 'summary', selection)
      .then((result) => current && setSummary(result))
      .catch(
        (failure: unknown) =>
          current &&
          setError(failure instanceof Error ? failure.message : 'Charts could not load.'),
      )
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [request, selection]);
  const weeks = summary ? trainingHoursWeeks(summary, today, duration) : [];
  return (
    <>
      <Button variant="link" className="charts-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" /> All templates
      </Button>
      <PageHeader title="Training hours" />
      <div className="charts-filters">
        <Field label="Period">
          <NativeSelect
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
          >
            {Object.entries(periods).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {period === 'custom' && (
          <>
            <Field label="From">
              <Input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <ErrorMessage error={typeof selection === 'string' ? selection : error} />
      {summary && !hasSessions(summary) ? (
        <EmptyState icon={<ChartColumn size={25} />} title="No training in this period">
          Planned and recorded sessions will appear here.
        </EmptyState>
      ) : (
        summary && <TrainingHoursFigure summary={summary} weeks={weeks} loading={loading} />
      )}
    </>
  );
}

function TrainingHoursFigure({
  summary,
  weeks,
  loading,
}: {
  summary: ChartsSummary;
  weeks: TrainingHoursWeek[];
  loading: boolean;
}) {
  return (
    <figure className="charts-figure" aria-busy={loading} data-loading={loading}>
      <figcaption>
        <h2>Weekly training hours</h2>
        <p>
          Recorded hours as bars and planned hours as a dashed line, per week from{' '}
          {dateLabel(weeks[0]!.weekStart)} to{' '}
          {dateLabel(addDays(weeks.at(-1)!.weekStart, 6), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          . Races are vertical lines.
        </p>
      </figcaption>
      <ul className="charts-legend" aria-label="Legend">
        <li>
          <span className="charts-key charts-key-recorded" aria-hidden="true" />
          Recorded
        </li>
        <li>
          <span className="charts-key charts-key-planned" aria-hidden="true" />
          Planned
        </li>
        {summary.races.length > 0 && (
          <li>
            <span className="charts-key charts-key-race" aria-hidden="true" />
            Race
          </li>
        )}
      </ul>
      <Suspense fallback={<div className="charts-plot" />}>
        <TrainingHoursChart weeks={weeks} />
      </Suspense>
      <TrainingHoursTable weeks={weeks} />
    </figure>
  );
}

function TrainingHoursTable({ weeks }: { weeks: TrainingHoursWeek[] }) {
  return (
    <details className="charts-values">
      <summary>View values</summary>
      <div className="charts-values-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Planned</TableHead>
              <TableHead>Races</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((week) => (
              <TableRow key={week.weekStart}>
                <TableCell>
                  Week of {dateLabel(week.weekStart)}
                  {week.inProgress && ' (in progress)'}
                </TableCell>
                <TableCell>{week.recordedLabel}</TableCell>
                <TableCell>{week.plannedLabel}</TableCell>
                <TableCell>{week.races.join(', ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
