'use client';

import { chartsMaxWeeks, type ChartsSummaryInput } from '@athlete-panel/contracts';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  Button,
  ErrorMessage,
  Field,
  Input,
  localDate,
  NativeSelect,
  PageHeader,
  startOfWeek,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { seasonStart } from './season';
import { TrainingBySportFigure } from './training-by-sport-figure';
import { TrainingHoursFigure } from './training-hours-figure';
import { useChartsSummary } from './use-charts-summary';
import './charts.css';

const templates = [
  {
    id: 'training-hours',
    title: 'Training hours',
    description: 'Compare planned and recorded hours, with your races.',
    Figure: TrainingHoursFigure,
  },
  {
    id: 'training-by-sport',
    title: 'Training by sport',
    description: 'See which sports fill your recorded hours, against the plan.',
    Figure: TrainingBySportFigure,
  },
] as const;
type Template = (typeof templates)[number];
const periods = {
  '4': 'Last 4 weeks',
  '12': 'Last 12 weeks',
  '52': 'Last 52 weeks',
  season: 'This season',
  custom: 'Custom dates',
} as const;
type Period = keyof typeof periods;

const weekCount = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000)) + 1;

export default function ChartsPage({ data }: PluginPageProps) {
  const [template, setTemplate] = useState<Template | null>(null);
  const today = localDate(new Date(), data.profile?.timezone);
  return template ? (
    <TemplatePage
      template={template}
      today={today}
      season={seasonStart(data, today)}
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
              onClick={() => setTemplate(item)}
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

function TemplatePage({
  template,
  today,
  season,
  onBack,
}: {
  template: Template;
  today: string;
  season: string;
  onBack: () => void;
}) {
  const { weekStartsOn } = useWorkspace();
  const currentWeek = startOfWeek(today, weekStartsOn);
  const [period, setPeriod] = useState<Period>('12');
  const [customFrom, setCustomFrom] = useState(addDays(currentWeek, -7 * 11));
  const [customTo, setCustomTo] = useState(today);
  const selection: ChartsSummaryInput | string = useMemo(() => {
    if (period === 'custom' && (!customFrom || !customTo || customTo < customFrom))
      return 'Choose an end date on or after the start date.';
    const from =
      period === 'custom'
        ? customFrom
        : period === 'season'
          ? season
          : addDays(currentWeek, -7 * (Number(period) - 1));
    const weekStart = startOfWeek(from, weekStartsOn);
    const weeks = weekCount(
      weekStart,
      period === 'custom' ? startOfWeek(customTo, weekStartsOn) : currentWeek,
    );
    return weeks > chartsMaxWeeks
      ? `Choose a period of at most ${chartsMaxWeeks} weeks.`
      : { weekStart, weeks };
  }, [period, currentWeek, season, customFrom, customTo, weekStartsOn]);
  const chart = useChartsSummary(typeof selection === 'string' ? null : selection);
  return (
    <>
      <Button variant="link" className="charts-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" /> All templates
      </Button>
      <PageHeader title={template.title} />
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
      <ErrorMessage error={typeof selection === 'string' ? selection : chart.error} />
      {chart.error && (
        <Button variant="outline" onClick={chart.retry}>
          Try again
        </Button>
      )}
      {chart.summary && (
        <template.Figure summary={chart.summary} today={today} loading={chart.loading} />
      )}
    </>
  );
}
