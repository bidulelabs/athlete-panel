import { randomUUID } from 'node:crypto';
import { connection, transaction, type Transaction } from './db';
import { registry } from '../../../instance/registry.metadata';
import { canonical } from './crypto';
export const MAX_JOB_ATTEMPTS = 8;
export const retryDelay = (attempts: number) => Math.min(3_600_000, 2000 * 2 ** attempts);
export type Job = {
  id: string;
  plugin_id: string;
  kind: string;
  payload: any;
  progress: any;
  attempts: number;
  lease_owner: string;
  status: string;
  priority: number;
};
export async function enqueue(
  tx: Transaction,
  pluginId: string,
  kind: string,
  payload: unknown,
  priority = 0,
) {
  if (!Number.isSafeInteger(priority)) throw new Error('Invalid job priority');
  const [existing] = await tx<
    { id: string; status: string }[]
  >`select id,status from host.jobs where plugin_id=${pluginId} and kind=${kind} and status in ('queued','running','paused','disabled') order by case when status='disabled' then 1 else 0 end,created_at,id limit 1 for update`;
  if (existing) {
    // Retained work owns its checkpoint and deadline, even when a caller offers a newer payload.
    await tx`update host.jobs set priority=${priority} where id=${existing.id}`;
    return existing.id;
  }
  const id = randomUUID();
  await tx`insert into host.jobs(id,plugin_id,kind,status,payload,priority) values(${id},${pluginId},${kind},'queued',${tx.json(payload as never)},${priority})`;
  return id;
}
export async function claimJob(workerId: string): Promise<Job | null> {
  return transaction(async (tx) => {
    const enabled = registry.filter((e) => e.enabled).map((e) => e.manifest.id);
    await tx`update host.jobs set status='disabled',lease_owner=null,lease_until=null where plugin_id not in ${tx(enabled)} and status in ('queued','running')`;
    await tx`update host.jobs j set status='queued' where j.status='disabled' and j.plugin_id in ${tx(enabled)}
      and not exists(select 1 from host.jobs live where live.plugin_id=j.plugin_id and live.kind=j.kind and live.status in ('queued','running','paused'))
      and j.id=(select retained.id from host.jobs retained where retained.plugin_id=j.plugin_id and retained.kind=j.kind and retained.status='disabled' order by retained.created_at,retained.id limit 1)`;
    await tx`update host.jobs set attempts=attempts+1,status=case when attempts+1>=${MAX_JOB_ATTEMPTS} then 'failed' else 'queued' end,
      error='lease_expired',next_run_at=now()+least(3600000,2000*power(2,least(attempts+1,20)))*interval '1 millisecond',
      lease_owner=null,lease_until=null,updated_at=now() where status='running' and lease_until<=now()`;
    const [job] =
      await tx`select * from host.jobs j where status='queued' and next_run_at<=now() and plugin_id in ${tx(enabled)}
      and not exists(select 1 from host.jobs active where active.plugin_id=j.plugin_id and active.status='running' and active.lease_until>now())
      order by priority desc,created_at,id limit 1 for update skip locked`;
    if (!job) return null;
    await tx`update host.jobs set status='running',lease_owner=${workerId},lease_until=now()+interval '3 minutes',updated_at=now() where id=${job.id}`;
    return { ...job, lease_owner: workerId } as Job;
  });
}
/** Fenced fallback for handlers that throw before settling their own claim. */
export async function failClaimedJob(job: Job, code = 'handler_failed', permanent = false) {
  await transaction(async (tx) => {
    const [current] = await tx<
      Job[]
    >`select * from host.jobs where id=${job.id} and status='running' and lease_owner=${job.lease_owner} and lease_until>now() for update`;
    if (!current) return;
    if (canonical(current.payload) !== canonical(job.payload)) {
      await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null where id=${job.id}`;
      return;
    }
    const attempts = current.attempts + 1;
    await tx`update host.jobs set status=${permanent || attempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'queued'},attempts=${attempts},error=${code},next_run_at=${new Date(Date.now() + retryDelay(attempts))},lease_owner=null,lease_until=null,updated_at=now() where id=${job.id}`;
  });
}
/** Persist only operational state; exception messages may contain provider/private data. */
export async function workerHeartbeat(
  workerId: string,
  state: 'healthy' | 'maintenance' | 'degraded' = 'healthy',
  schedulerFailures: string[] = [],
) {
  const sql = connection(),
    now = new Date().toISOString();
  await sql`insert into host.settings(key,value) values('worker',${sql.json({ id: workerId, lastSeen: now, lastSuccess: now, state, consecutiveFailures: 0, schedulerFailures })}) on conflict(key) do update set value=host.settings.value || excluded.value`;
}
export async function workerFailure(workerId: string) {
  const sql = connection(),
    now = new Date().toISOString();
  await sql`insert into host.settings(key,value) values('worker',${sql.json({ id: workerId, lastSeen: now, lastFailure: now, state: 'failed', consecutiveFailures: 1 })}) on conflict(key) do update set value=host.settings.value || excluded.value || jsonb_build_object('consecutiveFailures',case when host.settings.value->>'id'=${workerId} then coalesce((host.settings.value->>'consecutiveFailures')::int,0)+1 else 1 end)`;
}
