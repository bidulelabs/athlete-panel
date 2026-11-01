import { historicalRecord, type HistorySelection } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
export async function garminHistoryVersion(tx: Transaction): Promise<string> {
  return (await tx`select revision::text from garmin.history_version where singleton=true`)[0]!
    .revision;
}
export async function garminHistoryAvailability(
  tx: Transaction,
  q: Pick<HistorySelection, 'from' | 'to' | 'category'>,
  streams: string[],
) {
  const rows = await tx<{ count: number; from: string | null; to: string | null }[]>`
    select count(*)::int as count, min(greatest(start_date,${q.from}::date))::text as "from",
      max(least(end_date,${q.to}::date))::text as "to"
    from garmin.coverage where stream=any(${streams}) and start_date<=${q.to}::date and end_date>=${q.from}::date`;
  return { category: 'coverage' as const, ...rows[0]! };
}
export async function readHistoryCoverage(tx: Transaction, q: HistorySelection, streams: string[]) {
  const rows = await tx<
    { id: string; date: string; data: Record<string, unknown> }[]
  >`select md5(stream||':'||start_date::text||':'||end_date::text) as id,
    greatest(start_date,${q.from}::date)::text as date,
    jsonb_build_object('stream',stream,'from',greatest(start_date,${q.from}::date)::text,
      'to',least(end_date,${q.to}::date)::text,
      'scanState',case when scan_state='in-progress' and scanned_at is not null then 'scanned' else scan_state end,
      'status',status,'hasCompletedScan',scanned_at is not null) as data
    from garmin.coverage where stream=any(${streams}) and start_date<=${q.to}::date and end_date>=${q.from}::date
      ${q.after ? tx`and (greatest(start_date,${q.from}::date)::text,md5(stream||':'||start_date::text||':'||end_date::text))>(${q.after.date},${q.after.id})` : tx``}
    order by date,id limit ${q.take}`;
  return rows.map((r) => historicalRecord('coverage', r.id, r.date, r.data));
}
