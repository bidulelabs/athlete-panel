/** Small console adapter used by the hosted controller; never exposed through HTTP. */
import { connection, closeDatabase } from '../packages/host/src/db';
import { checkSchema } from '../packages/host/src/schema';
import { createBackup } from './backup';
import { validateRetainedMigrations } from '../packages/host/src/migrations';
import { readFile } from 'node:fs/promises';
import { imageMetadataSchema } from './lib/release-data';
try {
  const command = process.argv[2];
  if (command === 'inspect' && process.argv.length === 3) {
    await checkSchema();
    const sql = connection();
    const [owner] = await sql`select exists(select 1 from host.owner) as present`;
    const [maintenance] = await sql`select value from host.settings where key='maintenance'`;
    console.log(JSON.stringify({ owner: owner.present, maintenance: maintenance?.value === true }));
  } else if (command === 'upgrade-check' && (process.argv.length === 3 || process.argv.length === 4 && process.argv[3] === '--accept-plugin-removals')) {
    await validateRetainedMigrations(process.cwd(), await connection()<{name:string;checksum:string}[]>`select name,checksum from host.migrations`);
    const candidate = imageMetadataSchema.parse(JSON.parse(await readFile('.athlete-panel-release.json', 'utf8')));
    const [installed] = await connection()`select value from host.settings where key='composition'`;
    if (!Array.isArray(installed?.value)) throw new Error('Missing installed composition');
    const removed = installed.value.filter((plugin: {id:string;enabled:boolean}) => plugin.enabled && !candidate.plugins.some(next => next.id === plugin.id && next.enabled));
    if (removed.length && process.argv[3] !== '--accept-plugin-removals') {
      console.error('Candidate removes or disables installed plugins. Preserve them in a custom image or explicitly review --accept-custom-changes. No migration started.');
      process.exitCode = 3;
    } else {
      console.log(JSON.stringify({ retainedMigrations: 'verified' }));
    }
  } else if (command === 'backup' && process.argv.length === 3) {
    const result = await createBackup({ databaseUrl: process.env.DATABASE_URL ?? '', keyFile: process.env.BACKUP_KEY_FILE ?? '', encryptionKey: process.env.ENCRYPTION_KEY ?? '', destination: process.env.BACKUP_DESTINATION ?? '' });
    console.log(JSON.stringify({ file: result.file.split('/').at(-1), createdAt: result.metadata.createdAt, verified: true }));
  } else throw new Error('Unknown hosted console command.');
} catch { console.error('Hosted console check failed. Inspect database availability, installed schema, keys and registered backup storage.'); process.exitCode = 1; }
finally { await closeDatabase(); }
