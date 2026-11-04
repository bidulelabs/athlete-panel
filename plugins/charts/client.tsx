'use client';

import {
  chartsMaxWeeks,
  type ChartsSummary,
  type ChartsSummaryInput,
} from '@athlete-panel/contracts';
import { useEffect, useMemo, useState } from 'react';
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
import { TrainingHoursFigure } from './training-hours-figure';
import './charts.css';

const templates = [
  {
    id: 'training-hours',
    title: 'Training hours',
    description: 'Compare planned and recorded hours, with your races.',
    Figure: TrainingHoursFigure,
  },
] as const;
type Template = (typeof templates)[number];
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
  const [template, setTemplate] = useState<Template | null>(null);
  return template ? (
    <TemplatePage
      template={template}
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
  request,
  onBack,
}: {
  template: Template;
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
      <ErrorMessage error={typeof selection === 'string' ? selection : error} />
      {summary && <template.Figure summary={summary} today={today} loading={loading} />}
    </>
  );
}
