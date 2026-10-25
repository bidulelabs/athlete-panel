import { randomUUID } from 'node:crypto';
import { connection,transaction,type Transaction } from './db';
import { registry } from '../../../instance/registry.metadata';
export type Job={id:string;plugin_id:string;kind:string;payload:any;progress:any;attempts:number;lease_owner:string;status:string};
export async function enqueue(tx:Transaction,pluginId:string,kind:string,payload:unknown) {
  const [existing]=await tx`select id from host.jobs where plugin_id=${pluginId} and kind=${kind} and status in ('queued','running','paused')`;
  if(existing)return existing.id as string;
  const id=randomUUID();await tx`insert into host.jobs(id,plugin_id,kind,status,payload) values(${id},${pluginId},${kind},'queued',${tx.json(payload as never)})`;return id;
}
export async function claimJob(workerId:string):Promise<Job|null> {
  return transaction(async tx=>{
    const enabled=registry.filter(e=>e.enabled).map(e=>e.manifest.id);
    await tx`update host.jobs set status='disabled',lease_owner=null,lease_until=null where plugin_id not in ${tx(enabled)} and status in ('queued','running')`;
    await tx`update host.jobs set status='queued',next_run_at=now() where plugin_id in ${tx(enabled)} and status='disabled'`;
    await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null where status='running' and lease_until<now()`;
    const [job]=await tx`select * from host.jobs j where status='queued' and next_run_at<=now() and plugin_id in ${tx(enabled)}
      and not exists(select 1 from host.jobs active where active.plugin_id=j.plugin_id and active.status='running' and active.lease_until>now())
      order by case when kind like '%recent' then 0 else 1 end,updated_at limit 1 for update skip locked`;
    if(!job)return null;
    await tx`update host.jobs set status='running',lease_owner=${workerId},lease_until=now()+interval '3 minutes',updated_at=now() where id=${job.id}`;
    return {...job,lease_owner:workerId} as Job;
  });
}
/** Persist only operational state; exception messages may contain provider/private data. */
export async function workerHeartbeat(workerId:string, state:'healthy'|'maintenance'='healthy') {
  const sql=connection(), now=new Date().toISOString();
  await sql`insert into host.settings(key,value) values('worker',${sql.json({id:workerId,lastSeen:now,lastSuccess:now,state,consecutiveFailures:0})}) on conflict(key) do update set value=host.settings.value || excluded.value`;
}
export async function workerFailure(workerId:string) {
  const sql=connection(), now=new Date().toISOString();
  await sql`insert into host.settings(key,value) values('worker',${sql.json({id:workerId,lastSeen:now,lastFailure:now,state:'failed',consecutiveFailures:1})}) on conflict(key) do update set value=host.settings.value || excluded.value || jsonb_build_object('consecutiveFailures',case when host.settings.value->>'id'=${workerId} then coalesce((host.settings.value->>'consecutiveFailures')::int,0)+1 else 1 end)`;
}
