import { type HistorySelection, historicalRecord } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
export async function recordsHistoryVersion(tx: Transaction): Promise<string> {
  const rows =
    await tx`select revision::text from activity_records.history_version where singleton=true`;
  return rows[0]!.revision;
}
export async function readRecordsHistory(tx: Transaction, q: HistorySelection) {
  const kind = q.category === 'health' ? 'health' : 'activity';
  const rows = await tx<{ id: string; date: string; data: Record<string, unknown> }[]>`
    select id,data->>'localDate' as date,
    jsonb_build_object('revision',revision,'title',data->'title','sport',data->'sport',
      'subgroup',data->'sportSubgroup','sportResolution',data->'sportResolution',
      'durationSeconds',data->'durationSeconds','distanceMeters',data->'distanceMeters',
      'elevationMeters',data->'elevationMeters','averageHeartRateBpm',data->'averageHeartRateBpm',
      'startedAt',data->'startedAt','dateSource',data->'dateSource',
      'source',coalesce(data#>>'{provenance,sourceAccountId}','unknown'),
      'sourceStream',data#>'{provenance,source}','externalId',data->'externalId',
      'metric',data->'metric','value',data->'value','measuredAt',data->'measuredAt',
      'restingHeartRateMayBeMinimum',data#>'{provenance,restingHeartRateMayBeMinimum}') as data
    from activity_records.records where kind=${kind} and deleted=false
      and data->>'localDate'>=${q.from} and data->>'localDate'<=${q.to}
      ${q.after ? tx`and (data->>'localDate',id)>(${q.after.date},${q.after.id})` : tx``}
      ${q.sport ? tx`and data->>'sport'=${q.sport}` : tx``}
      ${q.subgroup ? tx`and data->>'sportSubgroup'=${q.subgroup}` : tx``}
      ${q.metric ? tx`and data->>'metric'=${q.metric}` : tx``}
      ${q.recordId ? tx`and id=${q.recordId}` : tx``}
    order by data->>'localDate',id limit ${q.take}`;
  return rows.map((r) =>
    historicalRecord(
      q.category === 'health' ? 'health' : 'activities',
      r.id,
      r.date,
      Object.fromEntries(
        Object.entries(r.data).filter(
          ([key, value]) =>
            value !== null ||
            [
              'value',
              'durationSeconds',
              'distanceMeters',
              'elevationMeters',
              'averageHeartRateBpm',
              'measuredAt',
            ].includes(key),
        ),
      ),
    ),
  );
}
export async function recordsHistoryAvailability(tx: Transaction, q: HistorySelection) {
  const kind = q.category === 'health' ? 'health' : 'activity';
  const rows = await tx<
    { count: number; from: string | null; to: string | null }[]
  >`select count(*)::int as count,min(data->>'localDate') as "from",max(data->>'localDate') as "to" from activity_records.records where kind=${kind} and deleted=false and data->>'localDate'>=${q.from} and data->>'localDate'<=${q.to}`;
  return { category: q.category!, ...rows[0]! };
}
