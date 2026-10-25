import { connection } from './db';
import { registry,schemaSignature } from '../../../instance/registry.metadata';

export async function checkSchema() {
  const [signature]=await connection()`select value from host.settings where key='schemaSignature'`;
  if(signature?.value!==schemaSignature)throw new Error('Installed migrations are not supported by this application artifact.');
  const [row] = await connection()`select value from host.settings where key='composition'`;
  const expected = registry.map(e => ({id:e.manifest.id,version:e.manifest.version,enabled:e.enabled}));
  if (!row || JSON.stringify(row.value) !== JSON.stringify(expected)) {
    // JSONB object key order is immaterial.
    const normalize = (v: unknown) => JSON.stringify(v, ['id','version','enabled']);
    if (!row || normalize(row.value) !== normalize(expected)) throw new Error('Installed composition/schema differs; run coordinated migrations before startup.');
  }
}
