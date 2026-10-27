'use client';

import { Button, NativeSelect } from '@athlete-panel/ui';
import { useState } from 'react';
import { ArrowUpRight, Moon } from 'lucide-react';
import {
  addDays,
  dateLabel,
  DateNavigation,
  duration,
  EmptyState,
  MiniBars,
  PageHeader,
  Stat,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';

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
  const { from, to, navigate } = useWorkspace();
  const [metric, setMetric] = useState('sleepDurationSeconds');
  const dates = Array.from({ length: 21 }, (_, i) => addDays(from, i));
  const records = data.health.filter(
    (record) => record.localDate >= from && record.localDate <= to,
  );
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
      <PageHeader
        eyebrow="RECOVERY & DAILY CONTEXT"
        title="Health & sleep"
        description="A record of the everyday signals behind your training."
        actions={
          <Button variant="outline" className="button" onClick={() => navigate('/garmin')}>
            Manage import <ArrowUpRight size={15} />
          </Button>
        }
      />
      <div className="summary-strip" style={{ marginBottom: 0 }}>
        <DateNavigation />
      </div>
      {!records.length ? (
        <EmptyState
          icon={<Moon size={26} />}
          title="Make room for recovery"
          action={
            <Button
              variant="default"
              className="button primary"
              onClick={() => navigate('/garmin')}
            >
              Set up Garmin import
            </Button>
          }
        >
          Imported sleep and health records will appear here. Missing measurements stay unknown.
        </EmptyState>
      ) : (
        <>
          <div className="health-hero">
            <div>
              <div className="eyebrow">AVERAGE SLEEP</div>
              <div className="health-hero-value">{duration(averageSleep)}</div>
              <div className="health-hero-label">Across {knownSleep.length} recorded nights</div>
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
            <MiniBars
              values={dates.map(
                (date) =>
                  records.find((record) => record.metric === metric && record.localDate === date)
                    ?.value ?? null,
              )}
              labels={dates.map((date) => date.slice(-2))}
              formatter={(value) =>
                selected.format ? selected.format(value) : String(Math.round(value))
              }
              empty={`No ${selected.label.toLowerCase()} recorded for this period.`}
            />
            <p className="form-footnote">
              {dateLabel(from)} — {dateLabel(to)} · Gaps are unavailable measurements, not zero.
            </p>
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
