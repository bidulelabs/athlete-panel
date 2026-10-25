import { connectionMessage } from './connection-status';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dateSchema,activitySchema,healthRecordSchema,type EntityChange } from '../../packages/contracts/src';
import { connection,transaction,type Transaction } from '../../packages/host/src/db';
import { encrypt,decrypt,canonical,digest } from '../../packages/host/src/crypto';
import { idempotent } from '../../packages/host/src/idempotency';
import { assert } from '../../packages/host/src/errors';
import { enqueue,type Job } from '../../packages/host/src/jobs';
import { loadWorkspace,loadProfile,persistChanges,type WorkspaceLoadOptions } from '../../instance/services';
import { createGarminClient,GarminError,type CachedGarminToken } from './transport';
import { createSyncCursor,runSyncStep,getAccountIdentity,requestCoverageIdentity,type GarminSyncCursor } from './sync';
import { assertAccountBinding,streamMetrics,type HealthStream } from './normalize';
import { automaticHealthHistoryStart } from './history-policy';
import { recordsRepository } from '../activity-records/repository';
import { trainingRepository } from '../training/repository';

type Configuration={lastErrorCode?:string|null;verifiedGeneration?:string;encryptedKey?:string;generation:string;earliestDate:string;accountId:string|null;paused:boolean;lastSync:string|null;lastError:string|null};
export async function getConfiguration(tx=connection() as unknown as Transaction):Promise<Configuration|null> {const [row]=await tx`select value from host.settings where key='garmin'`;return row?.value??null;}
async function saveConfig(tx:Transaction,config:Configuration){await tx`insert into host.settings(key,value) values('garmin',${tx.json(config)}) on conflict(key) do update set value=excluded.value`;}
function today(timeZone='UTC'){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export async function configure(body:unknown){
  const input=z.object({key:z.string().trim().min(8).max(4096),earliestDate:dateSchema.optional(),idempotencyKey:z.uuid().optional()}).strict().parse(body);
  // Accept the old field from a stale client, but never let it restrict automatic history.
  return transaction(tx=>idempotent(tx,input.idempotencyKey??randomUUID(),{operation:'garmin.configure',keyDigest:digest(input.key)},async()=>{
    const old=await getConfiguration(tx),profile=await loadProfile(tx);const config:Configuration={...old,generation:randomUUID(),encryptedKey:encrypt(input.key),earliestDate:automaticHealthHistoryStart(old?.earliestDate),accountId:old?.accountId??null,paused:false,lastSync:old?.lastSync??null,lastError:null,lastErrorCode:null};
    await saveConfig(tx,config);await tx`delete from host.settings where key='garminToken'`;
    // Preserve existing checkpoints, but re-verify account binding before resuming imports.
    await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now(),error=null where plugin_id='garmin' and status in ('paused','running')`;
    for(const kind of ['garmin-recent','garmin-history']) {
      const active=await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='queued'`;
      if(!active.length){const [failed]=await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='failed' order by created_at desc limit 1`;if(failed)await tx`update host.jobs set status='queued',attempts=0,error=null,next_run_at=now() where id=${failed.id}`;}
    }
    await tx`update host.jobs set payload=jsonb_set(payload,'{cursor,earliestHealthDate}',to_jsonb(${config.earliestDate}::text))
      where plugin_id='garmin' and kind='garmin-history' and status='queued' and payload#>>'{cursor,activityFrom}' is null and payload#>>'{cursor,earliestHealthDate}'>${config.earliestDate}`;
    await enqueue(tx,'garmin','garmin-history',{cursor:createSyncCursor({today:today(profile?.timezone),earliestHealthDate:config.earliestDate,accountId:config.accountId,timeZone:profile?.timezone}),generation:config.generation});
    return {connected:true};
  }));
}
export async function sync(body:unknown){
  const input=z.object({mode:z.enum(['recent','full']).default('recent'),from:dateSchema.nullable().optional(),to:dateSchema.optional()}).strict().parse(body);
  return transaction(async tx=>{
    const config=await getConfiguration(tx);assert(config?.encryptedKey,'disconnected','Configure a Garmin key first.');assert(!config.paused,'paused','Resume Garmin import first.');
    const profile=await loadProfile(tx),end=input.to??today(profile?.timezone);
    assert(!input.to||input.from,'invalid_range','A targeted reimport requires both dates.');
    const targeted=!!(input.from&&input.to),automaticStart=automaticHealthHistoryStart(config.earliestDate);
    if(config.earliestDate!==automaticStart)await saveConfig(tx,{...config,earliestDate:automaticStart});
    const cursor=createSyncCursor({today:end,earliestHealthDate:targeted?input.from!:automaticStart,mode:input.mode==='full'?'initial':'recent',accountId:config.accountId,timeZone:profile?.timezone,...(targeted?{activityFrom:input.from!}:{})});
    const kind=input.mode==='full'?'garmin-history':'garmin-recent';
    // Expand an old automatic backfill in place. Explicit range repairs keep their own bounds.
    if(input.mode==='full'&&!targeted)await tx`update host.jobs set payload=jsonb_set(payload,'{cursor,earliestHealthDate}',to_jsonb(${automaticStart}::text))
      where plugin_id='garmin' and kind='garmin-history' and status in ('queued','running','paused','failed')
      and payload#>>'{cursor,activityFrom}' is null and payload#>>'{cursor,earliestHealthDate}'>${automaticStart}`;
    const exactEnd=targeted||input.mode==='recent';
    const matching=(saved:GarminSyncCursor)=>saved?.mode===cursor.mode&&saved.earliestHealthDate===cursor.earliestHealthDate&&(saved.activityFrom??null)===(cursor.activityFrom??null)&&(!exactEnd||saved.today===cursor.today);
    const active=await tx`select id,status,payload from host.jobs where plugin_id='garmin' and kind=${kind} and status in ('queued','running','paused') order by created_at desc`;
    if(active.length){assert(active.every(job=>matching(job.payload.cursor)),'import_busy','Finish or cancel the current import before requesting a different range.',409);return {id:active[0].id,status:active[0].status};}
    const [failed]=await tx`select id from host.jobs where plugin_id='garmin' and kind=${kind} and status='failed'
      and payload#>>'{cursor,mode}'=${cursor.mode} and payload#>>'{cursor,earliestHealthDate}'=${cursor.earliestHealthDate}
      and coalesce(payload#>>'{cursor,activityFrom}','')=${cursor.activityFrom??''}
      and (${!exactEnd} or payload#>>'{cursor,today}'=${cursor.today}) order by updated_at desc,created_at desc limit 1`;
    if(failed){await tx`update host.jobs set status='queued',attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now(),updated_at=now() where id=${failed.id}`;return {id:failed.id,status:'queued'};}
    const id=await enqueue(tx,'garmin',kind,{cursor,generation:config.generation});return {id,status:'queued'};
  });
}
export async function pause(body:unknown){const {paused}=z.object({paused:z.boolean()}).strict().parse(body);await transaction(async tx=>{
  const config=await getConfiguration(tx);assert(config,'disconnected','Configure Garmin first.');await saveConfig(tx,{...config,paused});
  if(paused)await tx`update host.jobs set status='paused',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running')`;
  else await tx`update host.jobs set status='queued',next_run_at=now(),lease_owner=null,lease_until=null where plugin_id='garmin' and status='paused'`;
});return {paused};}
export async function disconnect(){await transaction(async tx=>{const config=await getConfiguration(tx);if(config){const {encryptedKey,...rest}=config;await saveConfig(tx,{...rest,paused:true,generation:randomUUID()});}await tx`delete from host.settings where key='garminToken'`;await tx`update host.jobs set status='cancelled',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running','paused')`;});return {connected:false};}
export async function status(includeCoverage=true) {
  const config = await getConfiguration(), sql = connection();
  const coverage = includeCoverage ? await sql`select stream,start_date::text as "from",end_date::text as "to",status,records,missing_days as "missingDays",unknown_metrics as "unknownMetrics",error from garmin.coverage order by end_date desc,stream,start_date desc limit 300` : [];
  const [counts] = await sql`select count(*)::int as windows, count(*) filter(where status='failed')::int as failed, count(*) filter(where status='complete')::int as complete, count(*) filter(where status='no-data')::int as empty, count(*) filter(where status='unavailable')::int as unavailable from garmin.coverage`;
  const jobs = await sql`select id,kind,status,progress,error,next_run_at,updated_at from host.jobs where plugin_id='garmin' and kind in ('garmin-history','garmin-recent')
    order by case when status in ('queued','running','paused') then 0 else 1 end,updated_at desc limit 1`;
  const [history] = await sql`select status from host.jobs where plugin_id='garmin' and kind='garmin-history' order by created_at desc limit 1`;
  const job=jobs[0];
  const currentJob=job?{id:job.id,kind:job.kind,status:job.status,progress:job.progress?.label??'',nextRunAt:job.next_run_at?.toISOString()??null,retrying:job.status==='queued'&&!!job.error}:null;
  const connected = !!config?.encryptedKey, verified = connected && config?.verifiedGeneration === config?.generation;
  const result = { connected, verified, lastErrorCode:config?.lastErrorCode??null, currentJob, historyStatus:history?.status??null, checkedAt:new Date().toISOString(), paused: config?.paused ?? false, earliestDate: config?.earliestDate ?? null, lastSync: config?.lastSync ?? null, lastError: config?.lastError ?? null,
    status: !connected ? 'Disconnected' : config?.lastError ? 'Import needs attention' : config?.paused ? 'Paused' : verified ? 'Account verified' : 'Key saved — waiting for verification', coverage, coverageSummary: {windows:counts.windows as number,failed:counts.failed as number,complete:counts.complete as number,empty:counts.empty as number,unavailable:counts.unavailable as number} };
  return {...result, status: connectionMessage(result)};
}

export async function coveragePage(body: unknown) {
  const input = z.object({filter:z.enum(['all','failed','unavailable']).default('all'),offset:z.number().int().min(0).max(1000000).default(0)}).strict().parse(body);
  const sql=connection();
  const [count]=await sql`select count(*)::int as total from garmin.coverage where (${input.filter}='all' or status=${input.filter})`;
  const rows=await sql`select stream,start_date::text as "from",end_date::text as "to",status,records,missing_days as "missingDays",unknown_metrics as "unknownMetrics",error from garmin.coverage where (${input.filter}='all' or status=${input.filter}) order by end_date desc,stream,start_date desc limit 50 offset ${input.offset}`;
  return {rows,total:count.total,offset:input.offset,limit:50};
}
export async function scheduleRecent(){await transaction(async tx=>{const config=await getConfiguration(tx);if(!config?.encryptedKey||config.paused)return;
  const [last]=await tx`select created_at from host.jobs where plugin_id='garmin' and kind='garmin-recent' order by created_at desc limit 1`;
  if(last&&Date.now()-new Date(last.created_at).getTime()<60*60*1000)return;
  const profile=await loadProfile(tx);
  await enqueue(tx,'garmin','garmin-recent',{cursor:createSyncCursor({today:today(profile?.timezone),earliestHealthDate:automaticHealthHistoryStart(config.earliestDate),mode:'recent',accountId:config.accountId,timeZone:profile?.timezone}),generation:config.generation});
});}

const clients=new Map<string,ReturnType<typeof createGarminClient>>();
function clientFor(config:Configuration){let client=clients.get(config.generation);if(client)return client;clients.clear();
  client=createGarminClient({apiKey:decrypt(config.encryptedKey!),credentialGeneration:config.generation,tokenCache:{
    async load(generation){const [row]=await connection()`select value from host.settings where key='garminToken'`;if(!row||row.value.generation!==generation)return null;return JSON.parse(decrypt(row.value.encrypted)) as CachedGarminToken;},
    async save(token){await transaction(async tx=>{const current=await getConfiguration(tx);if(current?.generation===config.generation)await tx`insert into host.settings(key,value) values('garminToken',${tx.json({generation:config.generation,encrypted:encrypt(JSON.stringify(token))})}) on conflict(key) do update set value=excluded.value`;});},
    async clear(generation){await connection()`delete from host.settings where key='garminToken' and value->>'generation'=${generation}`;},
  }});clients.set(config.generation,client);return client;
}
export async function runGarminJob(job:Job){
  const config=await getConfiguration();if(!config?.encryptedKey||config.paused)return;
  let cursor=job.payload.cursor as GarminSyncCursor;
  let coverageCursor=cursor;
  let reverifiedIdentity=false;
  try {
    if(job.payload.generation!==config.generation&&cursor.phase!=='identity') {
      coverageCursor={...cursor,phase:'identity'};
      const identity=await getAccountIdentity(clientFor(config),cursor.today);
      assertAccountBinding(config.accountId,[identity]);cursor={...cursor,accountId:identity};
      reverifiedIdentity=true;
    }
    coverageCursor=cursor;
    const step=await runSyncStep(cursor,clientFor(config));
    await transaction(async tx=>{
      const current=await getConfiguration(tx),[lease]=await tx`select status,lease_owner,lease_until,payload from host.jobs where id=${job.id} for update`;
      if(current?.generation!==config.generation||current.paused||lease?.status!=='running'||lease.lease_owner!==job.lease_owner||new Date(lease.lease_until).getTime()<=Date.now())return;
      if(canonical(lease.payload)!==canonical(job.payload)){await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now() where id=${job.id}`;return;}
      assert(!current.accountId||current.accountId===step.accountId,'account_mismatch','This key belongs to a different Garmin account.',409);
      const selection:WorkspaceLoadOptions={records:'linked',activityExternalIds:step.activities.map(record=>`${step.accountId}:${record.externalId}`),healthExternalIds:step.healthRecords.map(record=>`${step.accountId}:${record.externalId}`)};
      const state=await loadWorkspace(tx,undefined,selection),changes:EntityChange[]=[];
      for(const [kind,imports] of [['activity',step.activities],['health',step.healthRecords]] as const){
        const existing=kind==='activity'?state.activities:state.health;
        for(const imported of imports){
          const externalId=`${step.accountId}:${imported.externalId}`,old=existing.find(r=>r.externalId===externalId);
          const next=(kind==='activity'?activitySchema:healthRecordSchema).parse({...imported,externalId,id:old?.id??randomUUID(),revision:old?.revision??1,provenance:{sourceAccountId:step.accountId,source:step.coverage.stream,...(kind==='health'&&'metric'in imported&&imported.metric==='restingHeartRateBpm'?{restingHeartRateMayBeMinimum:true}:{})}});
          if(old&&canonical(old)===canonical(next))continue;
          if(old)next.revision++;
          changes.push({entity:kind,id:next.id,before:old??null,after:next});
          if(kind==='activity') for(const workout of state.workouts.filter(w=>w.completion?.activityId===next.id)) {
            const a=activitySchema.parse(next);const after={...workout,revision:workout.revision+1,completion:{...workout.completion!,performedDate:a.localDate,durationSeconds:a.durationSeconds,distanceMeters:a.distanceMeters}};
            changes.push({entity:'workout',id:workout.id,before:workout,after});
          }
        }
      }
      await persistChanges(changes,tx);
      // Provider corrections must not break existing domain relationships.
      // A conflicting sport correction remains a visible retryable window after owner reconciliation.
      await loadWorkspace(tx,undefined,selection);
      const coverage=step.coverage;
      if(reverifiedIdentity)await tx`delete from garmin.coverage where status='failed' and stream='identity' and start_date='0001-01-01' and end_date=${cursor.today}`;
      // Old releases keyed errors by phase and the whole backfill start instead of the actual stream/window.
      await tx`delete from garmin.coverage where status='failed' and stream=${cursor.phase} and start_date<=${coverage.from??cursor.earliestHealthDate} and end_date=${cursor.windowEnd}`;
      if(coverage.stream==='identity')await tx`delete from garmin.coverage where status='failed' and stream='identity' and start_date=${coverage.from??'0001-01-01'} and end_date=${coverage.to}`;
      if(coverage.stream!=='identity'){
        const scanStatus=coverage.stream==='activities'&&coverage.status==='no-data'&&cursor.activityOffset>0?'complete':coverage.status;
        const accumulate=coverage.stream==='activities'&&cursor.activityOffset>0;
        await tx`insert into garmin.coverage(stream,start_date,end_date,status,records,error,missing_days,unknown_metrics) values(${coverage.stream},${coverage.from??'0001-01-01'},${coverage.to},${scanStatus},${coverage.returnedRecords},${coverage.errorCode??null},${coverage.missingDays},${coverage.unknownMetrics}) on conflict(stream,start_date,end_date) do update set status=excluded.status,records=case when ${accumulate} then garmin.coverage.records+excluded.records else excluded.records end,error=excluded.error,missing_days=excluded.missing_days,unknown_metrics=excluded.unknown_metrics,updated_at=now()`;
      }
      const done=step.nextCursor.phase==='done';
      const label=done?'Import complete':coverage.stream==='identity'?'Account verified':`${coverage.stream}: ${coverage.from??'available history'} – ${coverage.to}`;
      await saveConfig(tx,{...current,accountId:step.accountId,verifiedGeneration:config.generation,lastError:null,lastErrorCode:null,lastSync:done?new Date().toISOString():current.lastSync});
      await tx`update host.jobs set payload=${tx.json({cursor:step.nextCursor,generation:config.generation})},progress=${tx.json({phase:step.nextCursor.phase,stream:coverage.stream,to:coverage.to,label})},status=${done?'completed':'queued'},attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now()+interval '1.1 seconds',updated_at=now() where id=${job.id}`;
    });
  }catch(error){
    const known=error instanceof GarminError?error:null;
    const message=known?.message??'Import failed validation or persistence. The current window was not committed.';
    const attempts=job.attempts+1,retry=known?.retryable&&attempts<8;
    const delay=known?.retryAfterMs??Math.min(3600000,2000*2**attempts)*(0.8+Math.random()*0.4);
    await transaction(async tx=>{
      const current=await getConfiguration(tx),[lease]=await tx`select status,lease_owner,lease_until,payload from host.jobs where id=${job.id} for update`;
      if(current?.generation!==config.generation||current.paused||lease?.status!=='running'||lease.lease_owner!==job.lease_owner||new Date(lease.lease_until).getTime()<=Date.now())return;
      if(canonical(lease.payload)!==canonical(job.payload)){await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now() where id=${job.id}`;return;}
      await tx`update host.jobs set status=${retry?'queued':'failed'},attempts=${attempts},error=${message},next_run_at=${new Date(Date.now()+delay)},lease_owner=null,lease_until=null,updated_at=now() where id=${job.id} and lease_owner=${job.lease_owner}`;
      await saveConfig(tx,{...current,lastError:message,lastErrorCode:known?.code??'import_failed',paused:known?.code==='credentials_rejected'||known?.code==='account_mismatch'?true:current.paused});
      if(known?.code==='credentials_rejected'||known?.code==='account_mismatch')await tx`update host.jobs set status='paused',lease_owner=null,lease_until=null where plugin_id='garmin' and status in ('queued','running')`;
      let coverage:ReturnType<typeof requestCoverageIdentity>|null=null;
      try{coverage=requestCoverageIdentity(coverageCursor);}catch{/* An invalid checkpoint has no trustworthy request window. The job retains its error. */}
      if(coverage){
        const metrics=streamMetrics[coverage.stream as HealthStream];
        const missingDays=metrics&&coverage.from!==null?Math.max(0,Math.floor((Date.parse(coverage.to)-Date.parse(coverage.from))/86400000)+1):0;
        await tx`insert into garmin.coverage(stream,start_date,end_date,status,records,error,missing_days,unknown_metrics) values(${coverage.stream},${coverage.from??'0001-01-01'},${coverage.to},'failed',0,${message},${missingDays},${missingDays*(metrics?.length??0)}) on conflict(stream,start_date,end_date) do update set status='failed',error=excluded.error,missing_days=excluded.missing_days,unknown_metrics=excluded.unknown_metrics,updated_at=now()`;
      }
    });
  }
}
