import {
  healthMetricSchema,
  type HistorySummarySelection,
  type HistoryRecordOf,
  type HistoryRecord,
  type HistoryScope,
  type HistorySummary,
} from '@athlete-panel/contracts';
import { addDays } from '../training/public/shared';

type Period = {
  from: string;
  to: string;
  periodStart: string;
  partial: boolean;
  calendarDays: number;
};
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
export function historyPeriods(
  from: string,
  to: string,
  period: 'month' | 'week',
  weekStartsOn: number,
): Period[] {
  let start =
    period === 'month'
      ? `${from.slice(0, 7)}-01`
      : addDays(from, -((new Date(`${from}T12:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7));
  const periods: Period[] = [];
  while (start <= to) {
    const next =
      period === 'week'
        ? addDays(start, 7)
        : (() => {
            const d = new Date(`${start}T12:00:00Z`);
            d.setUTCMonth(d.getUTCMonth() + 1);
            return d.toISOString().slice(0, 10);
          })();
    const end = addDays(next, -1),
      a = start < from ? from : start,
      b = end > to ? to : end;
    periods.push({
      from: a,
      to: b,
      periodStart: start,
      partial: a !== start || b !== end,
      calendarDays: days(a, b),
    });
    start = next;
  }
  return periods;
}
type SummaryFacts = Omit<HistorySummary, 'reference' | 'detailReferences'>;
type PeriodFor = (date: string) => Period | undefined;
const measurement = () => ({ value: null as number | null, knownCount: 0, missingCount: 0 });
function addMeasure(target: ReturnType<typeof measurement>, value: number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    target.value = (target.value ?? 0) + value;
    target.knownCount++;
  } else target.missingCount++;
}
function volumeRow(
  p: Period,
  category: 'activities' | 'planned' | 'actual',
  sport: string,
  subgroup: string | null,
) {
  return {
    ...p,
    category,
    sport,
    subgroup,
    count: 0,
    activeDays: 0,
    sessionsPerSevenDays: 0,
    durationSeconds: measurement(),
    distanceMeters: measurement(),
    elevationMeters: measurement(),
    statuses: {} as Record<string, number>,
    possibleDuplicateCount: 0,
    unsupportedRecords: 0,
  };
}
/** Imported activities and manual completions share this calculation so linked snapshots cannot double count. */
function trainingTotals(periodFor: PeriodFor) {
  type Volume = { row: ReturnType<typeof volumeRow>; days: Set<string> };
  type Facts = Pick<
    HistoryRecordOf<'activities'>['data'],
    | 'sport'
    | 'subgroup'
    | 'durationSeconds'
    | 'distanceMeters'
    | 'elevationMeters'
    | 'unsupportedFields'
  >;
  const volumes = new Map<string, Volume>(),
    activityDays = new Set<string>();
  const manualDays: { key: string; volume: Volume }[] = [];
  function add(
    category: 'activities' | 'planned' | 'actual',
    date: string,
    facts: Facts,
    status?: string,
  ) {
    const p = periodFor(date);
    if (!p) return;
    const sport = facts.sport ?? 'unknown',
      subgroup = facts.subgroup ?? null;
    const key = JSON.stringify([p.periodStart, category, sport, subgroup]);
    const v = volumes.get(key) ?? {
      row: volumeRow(p, category, sport, subgroup),
      days: new Set<string>(),
    };
    volumes.set(key, v);
    v.row.count++;
    v.days.add(date);
    v.row.activeDays = v.days.size;
    v.row.sessionsPerSevenDays = (v.row.count * 7) / p.calendarDays;
    addMeasure(v.row.durationSeconds, facts.durationSeconds);
    addMeasure(v.row.distanceMeters, facts.distanceMeters);
    addMeasure(v.row.elevationMeters, facts.elevationMeters);
    if (status) v.row.statuses[status] = (v.row.statuses[status] ?? 0) + 1;
    if (facts.unsupportedFields?.length) v.row.unsupportedRecords++;
    return v;
  }
  return {
    ingest(r: HistoryRecordOf<'activities' | 'workouts'>) {
      if (r.category === 'activities') {
        add('activities', r.date, r.data);
        add('actual', r.date, r.data);
        activityDays.add(`${r.date}:${r.data.sport ?? 'unknown'}`);
      } else if (r.data.kind !== 'rest') {
        const d = r.data;
        if (d.scheduledDate) add('planned', d.scheduledDate, d, d.completionStatus ?? 'pending');
        if (
          d.completionSource === 'manual' &&
          d.completionStatus !== 'skipped' &&
          d.performedDate
        ) {
          const volume = add('actual', d.performedDate, {
            ...d,
            durationSeconds: d.actualDurationSeconds,
            distanceMeters: d.actualDistanceMeters,
            elevationMeters: null,
          });
          if (volume)
            manualDays.push({ key: `${d.performedDate}:${d.sport ?? 'unknown'}`, volume });
        }
      }
    },
    finish(): SummaryFacts[] {
      for (const { key, volume } of manualDays)
        if (activityDays.has(key)) volume.row.possibleDuplicateCount++;
      return [...volumes.values()].map((v) => v.row);
    },
  };
}

type HealthRecord = HistoryRecordOf<'health'>;
const seriesKey = (r: HealthRecord) =>
  JSON.stringify([
    r.data.metric ?? 'unknown',
    r.data.source ?? 'unknown',
    r.data.sourceStream ?? 'unknown',
  ]);
function healthTotals(periodFor: PeriodFor) {
  const daily = new Map<string, { record: HealthRecord; count: number }>();
  return {
    ingest(record: HealthRecord) {
      const key = `${seriesKey(record)}:${record.date}`,
        old = daily.get(key);
      const a = record.data,
        b = old?.record.data;
      const newer =
        !b ||
        (a.revision ?? 0) > (b.revision ?? 0) ||
        ((a.revision ?? 0) === (b.revision ?? 0) &&
          `${a.measuredAt ?? ''}:${record.id}` > `${b.measuredAt ?? ''}:${old!.record.id}`);
      daily.set(key, { record: newer ? record : old!.record, count: (old?.count ?? 0) + 1 });
    },
    finish(periods: Period[], metricFilter?: HistorySummarySelection['metric']): SummaryFacts[] {
      // Resolve corrections first, then visit each corrected day once. Cells retain totals, not duplicate record arrays.
      const sources = new Map<
        string,
        { metric: string; source: string; sourceStream: string; supported: boolean }
      >();
      const cells = new Map<
        string,
        {
          count: number;
          days: number;
          known: Set<string>;
          sum: number;
          min: number | null;
          max: number | null;
          unsupported: number;
          uncertain: number;
        }
      >();
      const dailySources = new Map<string, Set<string>>();
      const unsupportedMetrics = new Set<string>();
      for (const { record: r, count } of daily.values()) {
        const key = seriesKey(r),
          d = r.data;
        const metric = d.metric ?? 'unknown',
          source = d.source ?? 'unknown',
          sourceStream = d.sourceStream ?? 'unknown';
        const series = sources.get(key) ?? {
          metric,
          source,
          sourceStream,
          supported: healthMetricSchema.safeParse(metric).success,
        };
        sources.set(key, series);
        if (!series.supported) unsupportedMetrics.add(metric);
        const p = periodFor(r.date);
        if (!p) continue;
        const cellKey = `${p.periodStart}:${key}`;
        const cell = cells.get(cellKey) ?? {
          count: 0,
          days: 0,
          known: new Set<string>(),
          sum: 0,
          min: null,
          max: null,
          unsupported: 0,
          uncertain: 0,
        };
        cells.set(cellKey, cell);
        cell.count += count;
        cell.days++;
        if (!series.supported || d.unsupportedFields?.length) cell.unsupported += count;
        if (typeof d.value === 'number') {
          const dayKey = `${r.date}:${metric}`,
            accounts = dailySources.get(dayKey) ?? new Set<string>();
          accounts.add(JSON.stringify([source, sourceStream]));
          dailySources.set(dayKey, accounts);
          if (series.supported) {
            cell.known.add(r.date);
            cell.sum += d.value;
            cell.min = cell.min === null ? d.value : Math.min(cell.min, d.value);
            cell.max = cell.max === null ? d.value : Math.max(cell.max, d.value);
            if (d.restingHeartRateMayBeMinimum) cell.uncertain++;
          }
        }
      }
      const metrics = metricFilter
        ? [metricFilter]
        : [...healthMetricSchema.options, ...unsupportedMetrics];
      const rows: SummaryFacts[] = [];
      for (const metric of metrics) {
        const matching = [...sources.values()].filter((s) => s.metric === metric);
        const series = matching.length
          ? matching
          : [{ metric, source: 'unknown', sourceStream: 'unknown', supported: true }];
        for (const s of series)
          for (const p of periods) {
            const key = JSON.stringify([metric, s.source, s.sourceStream]),
              cell = cells.get(`${p.periodStart}:${key}`);
            if (!s.supported && !cell) continue;
            const known = cell?.known.size ?? 0;
            const unit = !s.supported
              ? 'unknown'
              : metric.endsWith('Seconds')
                ? 'seconds'
                : metric.endsWith('Bpm')
                  ? 'bpm'
                  : metric.endsWith('Milliseconds')
                    ? 'milliseconds'
                    : metric === 'steps'
                      ? 'steps'
                      : 'provider score';
            rows.push({
              ...p,
              category: 'health',
              source: s.source,
              sourceStream: s.sourceStream,
              metric,
              unit,
              count: cell?.count ?? 0,
              mean: known ? cell!.sum / known : null,
              min: cell?.min ?? null,
              max: cell?.max ?? null,
              ...(metric === 'steps' ? { sum: known ? cell!.sum : null } : {}),
              contributingRecords: known,
              contributingDays: known,
              missingDays: p.calendarDays - known,
              unknownDays: (cell?.days ?? 0) - known,
              ambiguousDays: [...(cell?.known ?? [])].filter(
                (date) => (dailySources.get(`${date}:${metric}`)?.size ?? 0) > 1,
              ).length,
              uncertainRecords: cell?.uncertain ?? 0,
              unsupportedRecords: cell?.unsupported ?? 0,
            });
          }
      }
      return rows;
    },
  };
}
function coverageTotals() {
  const windows = new Map<string, HistoryRecordOf<'coverage'>[]>();
  return {
    ingest(r: HistoryRecordOf<'coverage'>) {
      const stream = windows.get(r.data.stream) ?? [];
      stream.push(r);
      windows.set(r.data.stream, stream);
    },
    finish(periods: Period[], scope: HistoryScope): SummaryFacts[] {
      const rows: SummaryFacts[] = [];
      const streams = [
        ...(scope.categories.includes('activities') ? ['activities'] : []),
        ...(scope.categories.includes('health')
          ? ['sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery']
          : []),
      ];
      for (const p of periods)
        for (const stream of streams) {
          const relevant = (windows.get(stream) ?? []).filter(
            (r) => r.data.from <= p.to && r.data.to >= p.from,
          );
          const scanned = new Set<string>(),
            failed = new Set<string>(),
            unavailable = new Set<string>();
          for (const { data: d } of relevant)
            for (
              let date = d.from < p.from ? p.from : d.from;
              date <= (d.to > p.to ? p.to : d.to);
              date = addDays(date, 1)
            ) {
              if (d.hasCompletedScan) scanned.add(date);
              if (d.scanState === 'failed') failed.add(date);
              if (d.scanState === 'unavailable') unavailable.add(date);
            }
          rows.push({
            ...p,
            category: 'coverage',
            source: stream,
            count: relevant.length,
            scannedDays: scanned.size,
            failedDays: failed.size,
            unavailableDays: unavailable.size,
            unscannedDays: p.calendarDays - scanned.size,
          });
        }
      return rows;
    },
  };
}
function evidence(
  row: SummaryFacts,
  q: HistorySummarySelection,
  scope: HistoryScope,
): HistorySummary {
  const category: HistoryRecord['category'] | undefined =
    row.category === 'activities'
      ? 'activities'
      : row.category === 'planned'
        ? 'workouts'
        : row.category === 'actual'
          ? undefined
          : row.category;
  const reference = {
    from: row.from,
    to: row.to,
    category,
    period: q.period,
    limit: 100,
    section: 'core' as const,
    sport: category === 'health' || category === 'coverage' ? undefined : q.sport,
    subgroup: category === 'health' || category === 'coverage' ? undefined : q.subgroup,
    metric: category === 'health' ? healthMetricSchema.safeParse(row.metric).data : undefined,
    recordId: q.recordId,
  };
  const kinds =
    row.category === 'actual'
      ? [
          ...(scope.categories.includes('activities') ? ['activities' as const] : []),
          ...(scope.categories.includes('training') ? ['workouts' as const] : []),
        ]
      : [category!];
  return {
    ...row,
    reference,
    detailReferences: kinds.map((category) => ({ ...reference, category })),
  };
}
export function historySummaryAccumulator(scope: HistoryScope, q: HistorySummarySelection) {
  const periods = historyPeriods(q.from, q.to, q.period, scope.weekStartsOn),
    dates = new Map<string, Period>();
  for (const p of periods)
    for (let date = p.from; date <= p.to; date = addDays(date, 1)) dates.set(date, p);
  const periodFor: PeriodFor = (date) => dates.get(date);
  const training = trainingTotals(periodFor),
    health = healthTotals(periodFor),
    coverage = coverageTotals();
  return {
    ingest(r: HistoryRecord) {
      switch (r.category) {
        case 'activities':
        case 'workouts':
          training.ingest(r);
          break;
        case 'health':
          health.ingest(r);
          break;
        case 'coverage':
          coverage.ingest(r);
          break;
      }
    },
    finish(): HistorySummary[] {
      const rows = training.finish();
      if (scope.categories.includes('health') && (!q.category || q.category === 'health'))
        rows.push(...health.finish(periods, q.metric));
      if (!q.category || q.category === 'coverage') rows.push(...coverage.finish(periods, scope));
      // Zero recorded sessions never asserts that no training happened.
      if (!q.category)
        for (const p of periods)
          for (const category of ['activities', 'planned', 'actual'] as const) {
            const allowed =
              category === 'planned'
                ? scope.categories.includes('training')
                : scope.categories.includes('activities') ||
                  (category === 'actual' && scope.categories.includes('training'));
            if (
              allowed &&
              !rows.some((r) => r.periodStart === p.periodStart && r.category === category)
            )
              rows.push({
                ...p,
                category,
                count: 0,
                activeDays: 0,
                sessionsPerSevenDays: 0,
                durationSeconds: measurement(),
                distanceMeters: measurement(),
                elevationMeters: measurement(),
              });
          }
      return rows
        .map((row) => evidence(row, q, scope))
        .sort((a, b) =>
          summaryKey(a) < summaryKey(b) ? -1 : summaryKey(a) > summaryKey(b) ? 1 : 0,
        );
    },
  };
}
export function summaryKey(row: HistorySummary) {
  return JSON.stringify([
    row.periodStart,
    row.category,
    row.sport ?? '',
    row.subgroup ?? '',
    row.source ?? '',
    row.sourceStream ?? '',
    row.metric ?? '',
  ]);
}
