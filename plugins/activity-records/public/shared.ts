import type { HealthRecord } from '@athlete-panel/contracts';

/** One corrected metric per provider/account/local date, including corrections to unknown. */
export function latestDailyHealth(records: readonly HealthRecord[]): HealthRecord[] {
  const latest = new Map<string, HealthRecord>();
  for (const record of records) {
    const key = JSON.stringify([
      record.provider,
      record.provenance?.sourceAccountId ?? null,
      record.localDate,
      record.metric,
    ]);
    const previous = latest.get(key);
    if (
      !previous ||
      record.revision > previous.revision ||
      (record.revision === previous.revision &&
        `${record.measuredAt ?? ''}:${record.id}` > `${previous.measuredAt ?? ''}:${previous.id}`)
    )
      latest.set(key, record);
  }
  return [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, record]) => record);
}
