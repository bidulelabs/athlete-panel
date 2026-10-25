import { cookies } from 'next/headers';
import { servers } from '../../../../../../../instance/registry.server';
import { requireSession,requireOrigin,SESSION_COOKIE } from '../../../../../../../packages/host/src/auth';
import { failure,json,readJson } from '../../../../../../../packages/host/src/http';
import { stagePlugin,pluginEnabled } from '../../../../../../../packages/host/src/plugins';
import { assert } from '../../../../../../../packages/host/src/errors';
import type { ServerPlugin } from '../../../../../../../packages/plugin-sdk/src';
export async function POST(request:Request,{params}:{params:Promise<{id:string;operation:string}>}){try{
  requireOrigin(request);await requireSession((await cookies()).get(SESSION_COOKIE)?.value);
  const {id,operation}=await params,body=await readJson(request);
  if(id==='host'&&operation==='plugins')return json(await stagePlugin(body));
  assert(pluginEnabled(id),'plugin_disabled','This plugin is not enabled.',404);
  const server=(servers as Record<string,ServerPlugin>)[id],handler=server?.operations[operation];
  assert(handler,'not_found','Operation does not exist.',404);
  return json(await handler(body,{actor:'owner'}));
}catch(e){return failure(e);}}
