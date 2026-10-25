import type { HealthRecord, Injury } from '@athlete-panel/contracts';

const stageDefinitions = [
  { metric: 'sleepDeepSeconds', key: 'deep', label: 'Deep' },
  { metric: 'sleepLightSeconds', key: 'light', label: 'Light' },
  { metric: 'sleepRemSeconds', key: 'rem', label: 'REM' },
  { metric: 'sleepAwakeSeconds', key: 'awake', label: 'Awake' },
] as const;

export interface SleepNight {
  id: string;
  date: string;
  durationSeconds: number | null;
  score: number | null;
  hrvMilliseconds: number | null;
  stages: Array<{ key: string; label: string; seconds: number | null; percent: number | null }>;
  stageTotal: number | null;
  stagesComplete: boolean;
}

/** One corrected metric per provider/account/local date, including corrections to unknown. */
export function latestDailyHealth(records: readonly HealthRecord[]): HealthRecord[] {
  const latest = new Map<string, HealthRecord>();
  for (const record of records) {
    const key = JSON.stringify([record.provider, record.provenance?.sourceAccountId ?? null, record.localDate, record.metric]);
    const previous = latest.get(key);
    if (!previous || record.revision > previous.revision || (record.revision === previous.revision &&
      `${record.measuredAt ?? ''}:${record.id}` > `${previous.measuredAt ?? ''}:${previous.id}`)) latest.set(key, record);
  }
  return [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, record]) => record);
}

/** Join only the same provider/account/day. Unknown provenance never joins a known account. */
export function sleepNights(records: readonly HealthRecord[]): SleepNight[] {
  const groups = new Map<string, Map<HealthRecord['metric'], HealthRecord>>();
  for (const record of latestDailyHealth(records)) {
    if (!record.metric.startsWith('sleep') && record.metric !== 'hrvMilliseconds') continue;
    const key = JSON.stringify([record.provider, record.provenance?.sourceAccountId ?? null, record.localDate]);
    const metrics = groups.get(key) ?? new Map<HealthRecord['metric'], HealthRecord>();
    metrics.set(record.metric, record);
    groups.set(key, metrics);
  }
  const nights: SleepNight[] = [];
  for (const [id, metrics] of groups) {
    if (![...metrics.values()].some(record => record.metric.startsWith('sleep') && record.value !== null)) continue;
    const value = (metric: HealthRecord['metric']) => metrics.get(metric)?.value ?? null;
    const stages = stageDefinitions.map(stage => ({ key: stage.key, label: stage.label, seconds: value(stage.metric), percent: null as number | null }));
    const stagesComplete = stages.every(stage => stage.seconds !== null);
    const stageTotal = stagesComplete ? stages.reduce((sum, stage) => sum + stage.seconds!, 0) : null;
    for (const stage of stages) stage.percent = stageTotal !== null && stageTotal > 0 ? stage.seconds! / stageTotal * 100 : null;
    nights.push({ id, date: metrics.values().next().value!.localDate, durationSeconds: value('sleepDurationSeconds'), score: value('sleepScore'), hrvMilliseconds: value('hrvMilliseconds'), stages, stageTotal, stagesComplete });
  }
  return nights.sort((a, b) => a.id.localeCompare(b.id));
}

export function injuriesOnDate(injuries: readonly Injury[], date: string): Injury[] {
  return injuries.filter(injury => injury.startDate <= date && (injury.endDate === null || injury.endDate >= date));
}
