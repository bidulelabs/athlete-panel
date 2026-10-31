import {
  healthMetricSchema,
  type HistoryQuery,
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
type Volume = { row: HistorySummary; days: Set<string> };
const measurement = () => ({ value: null as number | null, knownCount: 0, missingCount: 0 });
function addMeasure(target: ReturnType<typeof measurement>, value: number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    target.value = (target.value ?? 0) + value;
    target.knownCount++;
  } else target.missingCount++;
}
export function historySummaryAccumulator(
  scope: HistoryScope,
  q: HistoryQuery & { from: string; to: string },
) {
  const periods = historyPeriods(q.from, q.to, q.period, scope.weekStartsOn);
  const volumes = new Map<string, Volume>(),
    health = new Map<string, { record: HistoryRecord; count: number }>();
  const scans: HistoryRecord[] = [];
  const activityDays = new Set<string>(),
    manualDays: { key: string; volume: Volume }[] = [];
  const periodFor = (date: string) => periods.find((p) => date >= p.from && date <= p.to);
  function volume(
    category: 'activities' | 'planned' | 'actual',
    date: string,
    r: HistoryRecord,
    manual = false,
  ) {
    const p = periodFor(date);
    if (!p) return;
    const sport = r.data.sport ?? 'unknown',
      subgroup = r.data.subgroup ?? null;
    const key = JSON.stringify([p.periodStart, category, sport, subgroup]);
    let v = volumes.get(key);
    if (!v) {
      v = {
        days: new Set(),
        row: {
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
          statuses: {},
          possibleDuplicateCount: 0,
          unsupportedRecords: 0,
          reference: {
            ...q,
            from: p.from,
            to: p.to,
            cursor: undefined,
            reviewToken: undefined,
            category:
              category === 'activities'
                ? 'activities'
                : category === 'planned'
                  ? 'workouts'
                  : undefined,
          },
        },
      };
      volumes.set(key, v);
    }
    v.row.count++;
    v.days.add(date);
    v.row.activeDays = v.days.size;
    v.row.sessionsPerSevenDays = (v.row.count * 7) / p.calendarDays;
    addMeasure(
      v.row.durationSeconds!,
      manual ? r.data.actualDurationSeconds : r.data.durationSeconds,
    );
    addMeasure(v.row.distanceMeters!, manual ? r.data.actualDistanceMeters : r.data.distanceMeters);
    addMeasure(v.row.elevationMeters!, manual ? null : r.data.elevationMeters);
    if (category === 'planned') {
      const status = r.data.completionStatus ?? 'pending';
      v.row.statuses![status] = (v.row.statuses![status] ?? 0) + 1;
    }
    if (r.data.unsupportedFields?.length) v.row.unsupportedRecords!++;
    if (manual) manualDays.push({ key: `${date}:${sport}`, volume: v });
  }
  function ingest(r: HistoryRecord) {
    if (r.category === 'activities') {
      volume('activities', r.date, r);
      volume('actual', r.date, r);
      activityDays.add(`${r.date}:${r.data.sport ?? 'unknown'}`);
    } else if (r.category === 'workouts' && r.data.kind !== 'rest') {
      if (r.data.scheduledDate) volume('planned', r.data.scheduledDate, r);
      if (
        r.data.completionSource === 'manual' &&
        r.data.completionStatus !== 'skipped' &&
        r.data.performedDate
      )
        volume('actual', r.data.performedDate, r, true);
    } else if (r.category === 'health') {
      const key = JSON.stringify([
        r.data.source ?? 'unknown',
        r.data.sourceStream ?? 'unknown',
        r.date,
        r.data.metric ?? 'unknown',
      ]);
      const old = health.get(key),
        a = r.data,
        b = old?.record.data;
      const newer =
        !b ||
        (a.revision ?? 0) > (b.revision ?? 0) ||
        ((a.revision ?? 0) === (b.revision ?? 0) &&
          `${a.measuredAt ?? ''}:${r.id}` > `${b.measuredAt ?? ''}:${old!.record.id}`);
      health.set(key, { record: newer ? r : old!.record, count: (old?.count ?? 0) + 1 });
    } else if (r.category === 'coverage') scans.push(r);
  }
  function finish(): HistorySummary[] {
    for (const m of manualDays) if (activityDays.has(m.key)) m.volume.row.possibleDuplicateCount!++;
    const rows = [...volumes.values()].map((v) => v.row);
    const groupedHealth = new Map<string, { record: HistoryRecord; count: number }[]>(),
      dailySources = new Map<string, Set<string>>();
    for (const h of health.values()) {
      const p = periodFor(h.record.date);
      if (!p) continue;
      const key = JSON.stringify([
        p.periodStart,
        h.record.data.metric ?? 'unknown',
        h.record.data.source ?? 'unknown',
        h.record.data.sourceStream ?? 'unknown',
      ]);
      const bucket = groupedHealth.get(key) ?? [];
      bucket.push(h);
      groupedHealth.set(key, bucket);
      if (typeof h.record.data.value === 'number') {
        const dayKey = `${h.record.date}:${h.record.data.metric}`;
        const accounts = dailySources.get(dayKey) ?? new Set<string>();
        accounts.add(
          JSON.stringify([
            h.record.data.source ?? 'unknown',
            h.record.data.sourceStream ?? 'unknown',
          ]),
        );
        dailySources.set(dayKey, accounts);
      }
    }
    const sources = new Map<
      string,
      { source: string; sourceStream: string; metrics: Set<string> }
    >();
    const unsupportedMetrics = new Set<string>();
    for (const h of health.values()) {
      const source = h.record.data.source ?? 'unknown';
      const sourceStream = h.record.data.sourceStream ?? 'unknown';
      const key = JSON.stringify([source, sourceStream]);
      const series = sources.get(key) ?? { source, sourceStream, metrics: new Set<string>() };
      series.metrics.add(h.record.data.metric ?? 'unknown');
      sources.set(key, series);
      if (!healthMetricSchema.safeParse(h.record.data.metric).success)
        unsupportedMetrics.add(h.record.data.metric ?? 'unknown');
    }
    const sourcesFor = (metric: string) => {
      const matching = [...sources.values()].filter((s) => s.metrics.has(metric));
      return matching.length ? matching : [{ source: 'unknown', sourceStream: 'unknown' }];
    };
    const metrics = q.metric ? [q.metric] : [...healthMetricSchema.options, ...unsupportedMetrics];
    if (scope.categories.includes('health') && (!q.category || q.category === 'health'))
      for (const p of periods)
        for (const metric of metrics)
          for (const { source, sourceStream } of sourcesFor(metric)) {
            const candidates =
              groupedHealth.get(JSON.stringify([p.periodStart, metric, source, sourceStream])) ??
              [];
            const supportedMetric = healthMetricSchema.safeParse(metric);
            if (!supportedMetric.success && !candidates.length) continue;
            const known = supportedMetric.success
              ? candidates.filter((h) => typeof h.record.data.value === 'number')
              : [];
            const values = known.map((h) => h.record.data.value!);
            const ambiguous = known.filter(
              (h) => (dailySources.get(`${h.record.date}:${metric}`)?.size ?? 0) > 1,
            ).length;
            const unit = !supportedMetric.success
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
              source,
              sourceStream,
              metric,
              unit,
              count: candidates.reduce((n, h) => n + h.count, 0),
              mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
              min: values.length ? Math.min(...values) : null,
              max: values.length ? Math.max(...values) : null,
              ...(metric === 'steps'
                ? { sum: values.length ? values.reduce((a, b) => a + b, 0) : null }
                : {}),
              contributingRecords: known.length,
              contributingDays: known.length,
              missingDays: p.calendarDays - known.length,
              unknownDays: candidates.length - known.length,
              ambiguousDays: ambiguous,
              uncertainRecords: known.filter((h) => h.record.data.restingHeartRateMayBeMinimum)
                .length,
              unsupportedRecords: candidates
                .filter((h) => !supportedMetric.success || h.record.data.unsupportedFields?.length)
                .reduce((total, h) => total + h.count, 0),
              reference: {
                ...q,
                from: p.from,
                to: p.to,
                category: 'health',
                metric: supportedMetric.success ? supportedMetric.data : undefined,
                sport: undefined,
                subgroup: undefined,
                cursor: undefined,
                reviewToken: undefined,
              },
            });
          }
    if (!q.category || q.category === 'coverage')
      for (const p of periods)
        for (const stream of [
          ...(scope.categories.includes('activities') ? ['activities'] : []),
          ...(scope.categories.includes('health')
            ? ['sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery']
            : []),
        ]) {
          const relevant = scans.filter(
            (r) => r.data.stream === stream && r.data.from! <= p.to && r.data.to! >= p.from,
          );
          const scanned = new Set<string>(),
            failed = new Set<string>(),
            unavailable = new Set<string>();
          for (const r of relevant)
            for (
              let date = r.data.from! < p.from ? p.from : r.data.from!;
              date <= (r.data.to! > p.to ? p.to : r.data.to!);
              date = addDays(date, 1)
            ) {
              if (r.data.lastScannedAt) scanned.add(date);
              if (r.data.scanState === 'failed') failed.add(date);
              if (r.data.scanState === 'unavailable') unavailable.add(date);
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
            reference: {
              ...q,
              from: p.from,
              to: p.to,
              category: 'coverage',
              sport: undefined,
              subgroup: undefined,
              cursor: undefined,
              reviewToken: undefined,
            },
          });
        }
    // Include explicit empty recorded periods. Zero records never asserts no training happened.
    for (const p of periods)
      for (const category of ['activities', 'planned', 'actual'] as const) {
        const allowed =
          category === 'planned'
            ? scope.categories.includes('training')
            : scope.categories.includes('activities') ||
              (category === 'actual' && scope.categories.includes('training'));
        if (
          allowed &&
          !q.category &&
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
            reference: { ...q, from: p.from, to: p.to, cursor: undefined, reviewToken: undefined },
          });
      }
    for (const row of rows) {
      const kinds =
        row.category === 'actual'
          ? [
              ...(scope.categories.includes('activities') ? ['activities' as const] : []),
              ...(scope.categories.includes('training') ? ['workouts' as const] : []),
            ]
          : [row.category === 'planned' ? ('workouts' as const) : row.category];
      row.detailReferences = kinds.map((category) => ({
        ...row.reference,
        category,
        metric: category === 'health' ? healthMetricSchema.safeParse(row.metric).data : undefined,
      }));
    }
    return rows.sort((a, b) =>
      summaryKey(a) < summaryKey(b) ? -1 : summaryKey(a) > summaryKey(b) ? 1 : 0,
    );
  }
  return { ingest, finish };
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
