import { cookies } from 'next/headers';
import { dateSchema } from '../../../../../packages/contracts/src';
import { loadWorkspace } from '../../../../../instance/services';
import { requireSession,SESSION_COOKIE } from '../../../../../packages/host/src/auth';
import { connection,transaction } from '../../../../../packages/host/src/db';
import { failure,json } from '../../../../../packages/host/src/http';
import { pluginStatus,pluginEnabled } from '../../../../../packages/host/src/plugins';
import { assert } from '../../../../../packages/host/src/errors';
import { readOnboarding } from '../../../../../packages/host/src/onboarding';
import { status } from '../../../../../plugins/garmin/service';
export async function GET(request:Request){try{
  await requireSession((await cookies()).get(SESSION_COOKIE)?.value);const url=new URL(request.url);
  const from=dateSchema.parse(url.searchParams.get('from')),to=dateSchema.parse(url.searchParams.get('to'));
  assert(from<=to&&Date.parse(to)-Date.parse(from)<=121*86400000,'invalid_range','Choose a date range of at most 121 days.');
  const sql=connection();
  const [state,plugins,garmin,proposals,grants,changes,jobs,operational]=await Promise.all([
    transaction(tx=>loadWorkspace(tx,{from,to}),{allowMaintenance:true}),pluginStatus(),pluginEnabled('garmin')?status():Promise.resolve({connected:false,paused:false,earliestDate:null,lastSync:null,lastError:null,status:'Disabled',coverage:[]}),
    sql`select id,status,digest,created_at as "createdAt",changes,summary from host.proposals order by created_at desc limit 50`,
    sql`select id,label,expires_at as "expiresAt",revoked,scope->>'from' as "from",scope->>'to' as "to",(scope->>'includeNotes')::boolean as "includeNotes" from host.grants order by created_at desc limit 50`,
    sql`select id,created_at as "createdAt",summary,undone_at as "undoneAt",changes from host.changes order by created_at desc limit 50`,
    sql`select id,status,kind,progress,error,next_run_at as "nextRunAt",attempts from host.jobs order by created_at desc limit 50`,
    sql`select key,value from host.settings where key in ('worker','lastBackup','backupAttempt','backupSchedule','composition')`,
  ]);
  const schema=await sql`select plugin_id as "pluginId",name,applied_at as "appliedAt" from host.migrations order by applied_at,name`;
  return json({state,plugins,garmin,onboarding:await readOnboarding(),proposals:proposals.map(p=>({...p,warnings:[]})),grants,changes,jobs:jobs.map(j=>({...j,progress:j.progress?.label??j.progress?.phase??''})),operational:[...operational,{key:'schema',value:schema}]});
}catch(e){return failure(e);}}
