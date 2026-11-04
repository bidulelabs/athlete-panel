'use client';

import { Button, NativeSelect, ErrorMessage, Skeleton, localDate } from '@athlete-panel/ui';
import { useState } from 'react';
import { ArrowUpRight, Moon } from 'lucide-react';
import {
  dateLabel,
  duration,
  EmptyState,
  MiniBars,
  PageHeader,
  Stat,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { HistoryNavigation } from './history-navigation';
import { historyRange, type HistoryPeriod } from './history-range';
import { useHealthHistory } from './use-history';
import './history.css';

const METRICS: Record<string, { label: string; unit: string; format?: (n: number) => string }> = {
  sleepDurationSeconds: { label: 'Sleep duration', unit: '', format: duration },
  sleepDeepSeconds: { label: 'Deep sleep', unit: '', format: duration },
  sleepLightSeconds: { label: 'Light sleep', unit: '', format: duration },
  sleepRemSeconds: { label: 'REM sleep', unit: '', format: duration },
  sleepAwakeSeconds: { label: 'Awake during sleep', unit: '', format: duration },
  sleepScore: { label: 'Sleep score', unit: '/ 100' },
  restingHeartRateBpm: { label: 'Resting heart rate', unit: 'bpm' },
  hrvMilliseconds: { label: 'Heart-rate variability', unit: 'ms' },
  bodyBattery: { label: 'Body Battery', unit: '/ 100' },
  steps: { label: 'Daily steps', unit: 'steps' },
  stress: { label: 'Stress', unit: '/ 100' },
  activeKilocalories: { label: 'Active energy', unit: 'kcal' },
  totalKilocalories: { label: 'Total energy', unit: 'kcal' },
  respirationBreathsPerMinute: { label: 'Respiration', unit: 'breaths/min' },
  pulseOxPercent: { label: 'Pulse oxygen', unit: '%' },
};

export default function HealthPage({ data }: PluginPageProps) {
  const { navigate } = useWorkspace();
  const today = localDate(new Date(), data.profile?.timezone);
  const [days, setDays] = useState<HistoryPeriod>(30);
  const [endDate, setEndDate] = useState<string | null>(null);
  const { from, to, dates } = historyRange(endDate ?? today, days);
  const history = useHealthHistory(from, to);
  const [metric, setMetric] = useState('sleepDurationSeconds');
  const records = history.records ?? [];
  const knownSleep = records.filter(
    (record) => record.metric === 'sleepDurationSeconds' && record.value != null,
  );
  const averageSleep = knownSleep.length
    ? knownSleep.reduce((sum, record) => sum + record.value!, 0) / knownSleep.length
    : null;
  const latest = (id: string) =>
    records
      .filter((record) => record.metric === id && record.value != null)
      .sort((a, b) => b.localDate.localeCompare(a.localDate))[0];
  const format = (id: string, value: number | null | undefined) =>
    value == null
      ? '—'
      : METRICS[id]?.format
        ? METRICS[id]!.format!(value)
        : `${Math.round(value).toLocaleString()} ${METRICS[id]?.unit ?? ''}`;
  const selected = METRICS[metric]!;
  return (
    <>
      <div className="health-page-header">
        <PageHeader
          title="Health & sleep"
          description="Review your sleep and daily health measurements."
          actions={
            <Button variant="outline" className="button" onClick={() => navigate('/garmin')}>
              Manage import <ArrowUpRight size={15} />
            </Button>
          }
        />
      </div>
      <HistoryNavigation
        from={from}
        to={to}
        today={today}
        days={days}
        onDaysChange={setDays}
        onEndChange={(date) => setEndDate(date === today ? null : date)}
      />
      {history.loading ? (
        <div className="health-history-loading" role="status">
          <Skeleton className="h-24 w-full" />
          <p>Loading health history…</p>
        </div>
      ) : history.error ? (
        <div className="health-history-error">
          <ErrorMessage error={history.error} />
          <Button variant="outline" onClick={history.retry}>
            Try again
          </Button>
        </div>
      ) : !records.length ? (
        <EmptyState
          icon={<Moon size={26} />}
          title="No health records for these dates"
          action={
            <Button
              variant="default"
              className="button primary"
              onClick={() => navigate('/garmin')}
            >
              Manage import
            </Button>
          }
        >
          Choose another period or check your Garmin import. Missing measurements stay unknown.
        </EmptyState>
      ) : (
        <>
          <div className="health-hero">
            <div>
              <div className="health-average-label">Average sleep</div>
              <div className="health-hero-value">{duration(averageSleep)}</div>
              <div className="health-hero-label">
                {knownSleep.length} of {days} nights recorded
              </div>
            </div>
            <div className="health-hero-detail">
              <Stat
                label={
                  latest('restingHeartRateBpm')?.provenance?.restingHeartRateMayBeMinimum
                    ? 'Latest daily minimum HR'
                    : 'Latest resting HR'
                }
                value={format('restingHeartRateBpm', latest('restingHeartRateBpm')?.value)}
              />
              <Stat
                label="Latest HRV"
                value={format('hrvMilliseconds', latest('hrvMilliseconds')?.value)}
              />
              <Stat
                label="Latest sleep score"
                value={format('sleepScore', latest('sleepScore')?.value)}
              />
            </div>
          </div>
          <section className="chart-section">
            <div className="chart-section-title">
              <h2>{selected.label}</h2>
              <div className="filter-row">
                <NativeSelect
                  aria-label="Health metric"
                  value={metric}
                  onChange={(event) => setMetric(event.target.value)}
                >
                  {Object.entries(METRICS).map(([id, metadata]) => (
                    <option value={id} key={id}>
                      {metadata.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className={`health-history-chart health-history-chart-${days}`}>
              <MiniBars
                values={dates.map(
                  (date) =>
                    records.find((record) => record.metric === metric && record.localDate === date)
                      ?.value ?? null,
                )}
                labels={dates.map((date) => dateLabel(date))}
                formatter={(value) =>
                  selected.format ? selected.format(value) : String(Math.round(value))
                }
                empty={`No ${selected.label.toLowerCase()} recorded for this period.`}
              />
            </div>
            <p className="form-footnote">Gaps are unavailable measurements, not zero.</p>
            <details className="health-history-values">
              <summary>Daily measurements</summary>
              <div role="region" aria-label="Daily measurements" tabIndex={0}>
                <dl>
                  {dates
                    .slice()
                    .reverse()
                    .map((date) => {
                      const value = records.find(
                        (record) => record.metric === metric && record.localDate === date,
                      )?.value;
                      return (
                        <div key={date}>
                          <dt>
                            {dateLabel(date, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </dt>
                          <dd>{value == null ? 'Not recorded' : format(metric, value)}</dd>
                        </div>
                      );
                    })}
                </dl>
              </div>
            </details>
          </section>
          <div className="health-metrics">
            {Object.entries(METRICS)
              .filter(([id]) => !id.startsWith('sleep') || id === 'sleepScore')
              .map(([id, metadata]) => {
                const record = latest(id);
                return (
                  <div className="health-metric" key={id}>
                    <span>
                      {id === 'restingHeartRateBpm' &&
                      record?.provenance?.restingHeartRateMayBeMinimum
                        ? 'Garmin daily minimum HR'
                        : metadata.label}
                    </span>
                    <strong>{format(id, record?.value)}</strong>
                    <small>
                      {record
                        ? `Latest · ${dateLabel(record.localDate)}`
                        : 'No measurement available'}
                    </small>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </>
  );
}
