import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { claimJob,workerHeartbeat,workerFailure } from '../../packages/host/src/jobs';
import { checkSchema } from '../../packages/host/src/schema';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { AppError } from '../../packages/host/src/errors';
import { servers } from '../../instance/registry.server';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
const workerId=randomUUID();let stopping=false,lastSchedule=0,lastHeartbeat=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
await checkSchema();
while(!stopping){try{
  const [maintenance] = await connection()`select value from host.settings where key='maintenance'`;
  if (maintenance?.value === true) { await workerHeartbeat(workerId, 'maintenance'); lastHeartbeat=0; await setTimeout(1000); continue; }
  if(Date.now()-lastSchedule>30000){for(const plugin of Object.values(servers) as ServerPlugin[])await plugin.schedule?.();lastSchedule=Date.now();}
  const job=await claimJob(workerId);
  if(job){const plugin=(servers as Record<string,ServerPlugin>)[job.plugin_id];const handler=plugin?.jobs?.[job.kind];if(!handler)throw new Error('Missing job handler');await handler(job);}
  else await setTimeout(1000);
  if(Date.now()-lastHeartbeat>30000){await workerHeartbeat(workerId);lastHeartbeat=Date.now();}
}catch(error){lastHeartbeat=0;if(error instanceof AppError && error.code==='maintenance'){await workerHeartbeat(workerId,'maintenance');continue;}try{await workerFailure(workerId);}catch{/* Database outage: no status can be persisted. */}console.error(JSON.stringify({level:'error',event:'worker_iteration_failed',type:error instanceof Error?error.name:'Unknown'}));await setTimeout(3000);}}
await closeDatabase();
