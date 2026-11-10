'use client';

import {
  chartsMaxWeeks,
  chartsSports,
  isChartsVolumeTemplate,
  type ChartsGrouping,
  type ChartsSport,
  type ChartsSummaryInput,
} from '@athlete-panel/contracts';
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
import { RestingHeartRateHrvFigure } from './resting-heart-rate-hrv-figure';
import { seasonStart } from './season';
import { TrainingBySportFigure } from './training-by-sport-figure';
import { TrainingHoursFigure } from './training-hours-figure';
import { TrainingLoadFigure } from './training-load-figure';
import { useChartsSummary } from './use-charts-summary';
import { WeeklyClimbingFigure } from './weekly-climbing-figure';
import { WorkoutHeartRateFigure } from './workout-heart-rate-figure';
import { VolumeControls } from './volume-controls';
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
  {
    id: 'workout-heart-rate',
    title: 'Workout heart rate',
    description: 'Follow the average heart rate of each session, one sport at a time.',
    Figure: WorkoutHeartRateFigure,
  },
  {
    id: 'weekly-climbing',
    title: 'Weekly climbing',
    description: 'See elevation gain per sport, and how steep your running is.',
    Figure: WeeklyClimbingFigure,
  },
  {
    id: 'resting-heart-rate-hrv',
    title: 'Resting heart rate and HRV',
    description: 'Compare each night with its 7-day average and your usual range.',
    Figure: RestingHeartRateHrvFigure,
  },
  {
    id: 'estimated-training-load',
    title: 'Estimated training load',
    description: 'Estimate the daily load of your sessions from their heart rate.',
    Figure: TrainingLoadFigure,
  },
] as const;
type Template = (typeof templates)[number];
const periods = {
  '4': 'Last 4 weeks',
  '12': 'Last 12 weeks',
  '52': 'Last 52 weeks',
  season: 'This season',
  phases: 'Plan phases',
  custom: 'Custom dates',
} as const;
type Period = keyof typeof periods;

const weekCount = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86400000)) + 1;

export default function ChartsPage({ data }: PluginPageProps) {
  const [template, setTemplate] = useState<Template | null>(null);
  const today = localDate(new Date(), data.profile?.timezone);
  const phaseDates = useMemo(
    () =>
      data.periods.length
        ? {
            from: data.periods.map((period) => period.startDate).sort()[0]!,
            to: data.periods
              .map((period) => period.endDate)
              .sort()
              .at(-1)!,
          }
        : null,
    [data.periods],
  );
  return template ? (
    <TemplatePage
      template={template}
      today={today}
      season={seasonStart(data, today)}
      phaseDates={phaseDates}
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
  phaseDates,
  onBack,
}: {
  template: Template;
  today: string;
  season: string;
  phaseDates: { from: string; to: string } | null;
  onBack: () => void;
}) {
  const { weekStartsOn } = useWorkspace();
  const currentWeek = startOfWeek(today, weekStartsOn);
  const [sports, setSports] = useState<ChartsSport[]>([...chartsSports]);
  const [grouping, setGrouping] = useState<ChartsGrouping>('week');
  const volume = isChartsVolumeTemplate(template.id);
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
          : period === 'phases' && phaseDates
            ? phaseDates.from
            : addDays(currentWeek, -7 * (Number(period) - 1));
    const to =
      period === 'custom' ? customTo : period === 'phases' && phaseDates ? phaseDates.to : today;
    const weekStart = startOfWeek(from, weekStartsOn);
    const weeks = weekCount(weekStart, startOfWeek(to, weekStartsOn));
    return weeks > chartsMaxWeeks
      ? `Choose a period of at most ${chartsMaxWeeks} weeks.`
      : { template: template.id, weekStart, weeks, ...(volume ? { sports, grouping } : {}) };
  }, [
    template.id,
    period,
    currentWeek,
    season,
    phaseDates,
    customFrom,
    customTo,
    weekStartsOn,
    volume,
    sports,
    grouping,
  ]);
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
            {Object.entries(periods)
              .filter(([value]) => value !== 'phases' || phaseDates)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {volume && (
          <VolumeControls
            sports={sports}
            grouping={grouping}
            onSportsChange={setSports}
            onGroupingChange={setGrouping}
          />
        )}
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
