import { activitySchema, type Activity } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';

export type StoredAppleActivity = { activity: Activity; deleted: boolean; revision: number };

/** Includes inactive rows so a source replay can recover the same internal identity. */
export async function appleActivitiesById(tx: Transaction, ids: string[]) {
  if (!ids.length) return new Map<string, StoredAppleActivity>();
  const rows = await tx<{ id: string; data: unknown; deleted: boolean; revision: number }[]>`
    select id,data,deleted,revision from activity_records.records
    where kind='activity' and id=any(${ids}) and data->>'provider'='apple-health'`;
  return new Map(
    rows.map(({ id, data, ...row }) => [id, { ...row, activity: activitySchema.parse(data) }]),
  );
}

export async function appleActivitiesForSource(
  tx: Transaction,
  source: string,
): Promise<Activity[]> {
  const rows = await tx<{ data: unknown }[]>`
    select data from activity_records.records where kind='activity' and not deleted
    and data->>'provider'='apple-health' and data#>>'{appleHealth,recordingSource}'=${source}`;
  return rows.map(({ data }) => activitySchema.parse(data));
}

export async function saveActivityRoute(tx: Transaction, id: string, gpx: string) {
  await tx`insert into activity_records.routes(activity_id,gpx) values (${id},${gpx})
    on conflict(activity_id) do update set gpx=excluded.gpx
    where activity_records.routes.gpx is distinct from excluded.gpx`;
}

export async function removeActivityRoutes(tx: Transaction, ids: string[]) {
  if (ids.length) await tx`delete from activity_records.routes where activity_id=any(${ids})`;
}
