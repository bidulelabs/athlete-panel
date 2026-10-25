import { readFile,writeFile } from 'node:fs/promises';
import { connection,closeDatabase } from '../packages/host/src/db';
import { registry } from '../instance/registry.metadata';
import { manifestSchema,validateComposition } from '../packages/plugin-sdk/src';
const action=process.argv[2];
if(action!=='stage')throw new Error('Use pnpm plugins stage to write validated desired plugin configuration, then build, migrate and restart in maintenance mode.');
try {
  const [row]=await connection()`select value from host.settings where key='desiredPlugins'`;
  if(!row)throw new Error('No staged plugin changes.');
  const composition=JSON.parse(await readFile('instance/composition.json','utf8'));
  for(const entry of composition.plugins){const plugin=registry.find(e=>e.path===entry.path);if(plugin)entry.enabled=row.value[plugin.manifest.id]??entry.enabled;}
  validateComposition(registry.map(e=>manifestSchema.parse(e.manifest)),composition.plugins.filter((e:any)=>e.enabled).map((e:any)=>registry.find(p=>p.path===e.path)!.manifest.id));
  await writeFile('instance/composition.json',JSON.stringify(composition,null,2)+'\n');console.log('Staged composition written. Build and rehearse the upgrade before activation.');
}finally{await closeDatabase();}
