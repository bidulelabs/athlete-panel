import postgres, { type Sql } from 'postgres';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalError, type LocalConfig } from './local-config';

export function localDatabase(url: string) {
  // Keep the setup advisory lock alive while the owner is choosing a password.
  return postgres(url, { max: 1, connect_timeout: 5, idle_timeout: 0, onnotice: () => {} });
}

export async function installedSchema(sql: Sql, root: string) {
  const { registry, schemaSignature } = await import(pathToFileURL(join(root, 'instance/registry.metadata.ts')).href);
  const settings = await sql`select key,value from host.settings where key in ('schemaSignature','composition')`;
  const signature = settings.find(row => row.key === 'schemaSignature')?.value;
  const composition = settings.find(row => row.key === 'composition')?.value;
  const expected = registry.map((entry: { manifest: { id: string; version: string }; enabled: boolean }) => ({ id: entry.manifest.id, version: entry.manifest.version, enabled: entry.enabled }));
  const normalize = (value: unknown) => JSON.stringify(value, ['id', 'version', 'enabled']);
  if (signature !== schemaSignature || normalize(composition) !== normalize(expected)) throw new LocalError('This database needs a coordinated upgrade. Setup/local never upgrade an existing installation automatically. Follow docs/development.md#updating-a-local-checkout.');
}

export async function installationState(sql: Sql): Promise<'empty' | 'unfinished' | 'ready'> {
  const tables = await sql`select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname <> 'information_schema'`;
  if (!tables.length) {
    const schemas = await sql`select 1 from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema')`;
    if (!schemas.length) return 'empty';
    throw new LocalError('Existing database schemas are not an empty installation. No tables were changed. Use the recovery guide.');
  }
  if (!['owner', 'settings', 'migrations'].every(name => tables.some(row => row.schemaname === 'host' && row.tablename === name))) {
    throw new LocalError('Existing database contents are not a recognized Athlete Panel installation. No tables were changed. Use the recovery guide.');
  }
  return (await sql`select id from host.owner limit 1`).length ? 'ready' : 'unfinished';
}

export async function verifyRuntime(root: string, config: LocalConfig) {
  const sql = localDatabase(config.values.DATABASE_URL);
  try {
    const [role] = await sql`select oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user`;
    if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls || (await sql`select 1 from pg_auth_members where member=${role.oid}`).length) throw new LocalError('The application database account is not restricted. Follow the existing-installation permission transition in docs/development.md.');
    await installedSchema(sql, root);
    const [permissions] = await sql`select has_database_privilege(current_user,current_database(),'CREATE') or has_database_privilege(current_user,current_database(),'TEMP') or has_schema_privilege(current_user,'host','CREATE') or has_table_privilege(current_user,'host.owner','UPDATE') as excessive`;
    if (permissions.excessive) throw new LocalError('The application database account has administrative permissions. Follow the existing-installation permission transition in docs/development.md.');
    if (!(await sql`select id from host.owner limit 1`).length) throw new LocalError('Your owner account is not created yet. Run pnpm run setup to finish.');
  } catch (error) {
    if (error instanceof LocalError) throw error;
    throw new LocalError('Cannot open the configured application database. Check the saved .env and complete setup. Existing database passwords are never reset automatically.');
  } finally { await sql.end({ timeout: 5 }); }
}
