import { z } from 'zod';
import { registry } from '../../../instance/registry.metadata';
import { manifestSchema,validateComposition } from '../../plugin-sdk/src';
import { connection,transaction } from './db';
import { assert } from './errors';

export function pluginEnabled(id:string) { return registry.some(e=>e.manifest.id===id&&e.enabled); }
export async function pluginStatus() {
  const [row]=await connection()`select value from host.settings where key='desiredPlugins'`;
  return registry.map(e=>{const desired=row?.value?.[e.manifest.id]??e.enabled;return {id:e.manifest.id,name:e.manifest.name,description:e.manifest.description,version:e.manifest.version,enabled:e.enabled,desiredEnabled:desired,required:e.manifest.required,dependencies:Object.keys(e.manifest.dependencies),pending:desired!==e.enabled};});
}
export async function stagePlugin(body:unknown) {
  const input=z.object({id:z.string(),enabled:z.boolean()}).strict().parse(body);
  return transaction(async tx=>{
    const [row]=await tx`select value from host.settings where key='desiredPlugins'`;
    assert(registry.some(e=>e.manifest.id===input.id),'not_found','Plugin is not in this composition.',404);
    const desired=Object.fromEntries(registry.map(e=>[e.manifest.id,row?.value?.[e.manifest.id]??e.enabled]));
    desired[input.id]=input.enabled;
    validateComposition(registry.map(e=>manifestSchema.parse(e.manifest)),Object.keys(desired).filter(k=>desired[k]));
    await tx`insert into host.settings(key,value) values('desiredPlugins',${tx.json(desired)}) on conflict(key) do update set value=excluded.value`;
    return {pending:true,message:'Build the staged composition and restart to activate this change.'};
  });
}
