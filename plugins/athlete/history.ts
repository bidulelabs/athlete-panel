import { historicalRecord, profileSchema, type HistorySelection } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
export async function athleteHistoryVersion(tx: Transaction): Promise<string> {
  return (await tx`select revision::text from athlete.history_version where singleton=true`)[0]!
    .revision;
}
export async function historicalProfile(tx: Transaction) {
  const rows =
    await tx`select data from athlete.records where kind='profile' and deleted=false limit 1`;
  return rows[0] ? profileSchema.parse(rows[0].data) : null;
}
export async function readAthleteHistory(tx: Transaction, q: HistorySelection) {
  const rows = await tx<
    { id: string; date: string; data: Record<string, unknown> }[]
  >`select id,greatest(data->>'startDate',${q.from}) as date,
    jsonb_build_object('revision',revision,'bodyPart',data->'bodyPart','description',data->'description',
      'severity',data->'severity','startDate',case when data->>'startDate'>=${q.from} then data->>'startDate' end,
      'endDate',case when data->>'endDate'<=${q.to} then data->>'endDate' end,'from',greatest(data->>'startDate',${q.from}),'to',least(coalesce(data->>'endDate',${q.to}),${q.to}),'notes',data->'notes') as data
    from athlete.records where kind='injury' and deleted=false and data->>'startDate'<=${q.to}
      and (data->>'endDate' is null or data->>'endDate'>=${q.from})
      ${q.recordId ? tx`and id=${q.recordId}` : tx``}
      ${q.after ? tx`and (greatest(data->>'startDate',${q.from}),id)>(${q.after.date},${q.after.id})` : tx``}
    order by date,id limit ${q.take}`;
  return rows.map((r) => historicalRecord('injuries', r.id, r.date, r.data));
}
