import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import postgres from 'postgres';
import { verifyStorage } from './lib/backup-storage';
import { sourceFiles, sourceDigest, sha256 } from './lib/source-files';
import { releasedImageSchema, readImageMetadata } from './lib/release-data';

import { BACKUP_MAGIC, decodeKey, loadBackupKey, pgCommand, type BackupMetadata, type BackupOptions } from './lib/backup-format';
export { BACKUP_MAGIC, decodeKey, loadBackupKey, databaseEnvironment, pgCommand, type BackupMetadata, type BackupOptions } from './lib/backup-format';
async function* archive(entries: Array<{ path: string; file: string }>) {
  for (const entry of entries) {
    const size = (await stat(entry.file)).size;
    yield Buffer.from(`${JSON.stringify({ path: entry.path, size, sha256: await sha256(entry.file) })}\n`);
    for await (const chunk of createReadStream(entry.file)) yield chunk;
  }
  yield Buffer.from('{"end":true}\n');
}

// Store only safe status, never credential values, local paths or database errors.
export async function createBackup(options: BackupOptions): Promise<{ file: string; metadata: BackupMetadata }> {
  const startedAt = new Date().toISOString();
  const record = async (state: 'running' | 'succeeded' | 'failed') => {
    if (!options.databaseUrl) return;
    const statusSql = postgres(options.databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      await statusSql`insert into host.settings(key,value) values('backupAttempt',${statusSql.json({ state, startedAt, updatedAt: new Date().toISOString() })}) on conflict(key) do update set value=excluded.value`;
    } catch { /* If the database is unavailable, its status cannot be updated. */ }
    finally { await statusSql.end(); }
  };
  await record('running');
  try { const result = await writeBackup(options); await record('succeeded'); return result; }
  catch (error) { await record('failed'); throw error; }
}

async function writeBackup(options: BackupOptions): Promise<{ file: string; metadata: BackupMetadata }> {
  await verifyStorage(options.destination);
  const key = await loadBackupKey(options.keyFile);
  const applicationKey = decodeKey(options.encryptionKey, 'Application encryption key');
  if (key.equals(applicationKey)) { key.fill(0); applicationKey.fill(0); throw new Error('Use independent application encryption and backup keys.'); }
  const encryptionKeyFingerprint = createHash('sha256').update(applicationKey).digest('hex'); applicationKey.fill(0);
  const root = resolve(options.root ?? process.cwd());
  const stage = await mkdtemp(join(tmpdir(), 'athlete-panel-backup-'));
  await chmod(stage, 0o700);
  const sql = postgres(options.databaseUrl, { max: 1, onnotice: () => {} });
  let partial: string | null = null;
  try {
    const metadata = await sql.begin(async tx => {
      // Coordinate snapshot collection with all domain mutations and migration runs.
      await tx`select pg_advisory_xact_lock(736147002)`;
      await tx`select pg_advisory_xact_lock(736147001)`;
      // Freeze the exact source/configuration before releasing the database mutation locks.
      // Operators must run this from the immutable, currently installed release checkout.
      for (const entry of await sourceFiles(root)) {
        if (resolve(entry.file) === resolve(options.keyFile)) throw new Error('The backup key must be outside the source directories included in backups.');
        const target = join(stage, entry.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(entry.file, target); await chmod(target, 0o600);
      }
      const migrations = await tx`select plugin_id,name,checksum from host.migrations order by plugin_id,name`;
      for (const row of migrations) {
        if (typeof row.name !== 'string' || row.name.startsWith('/') || row.name.split('/').includes('..')) throw new Error('Invalid applied migration path.');
        if (await sha256(join(stage, 'source', row.name)) !== row.checksum) throw new Error(`Source does not match the applied migration: ${row.name}. Back up from the currently installed release.`);
      }
      const [composition] = await tx`select value from host.settings where key='composition'`;
      const installed = composition?.value;
      const desired = JSON.parse(await readFile(join(stage, 'source/instance/composition.json'), 'utf8')) as { plugins: Array<{ path: string; enabled: boolean; version: string }> };
      const archived = [];
      for (const plugin of desired.plugins) {
        if (!/^(plugins|personal-plugins)\/[a-z][a-z0-9-]*$/.test(plugin.path)) throw new Error('Invalid plugin path in source composition.');
        const manifest = JSON.parse(await readFile(join(stage, 'source', plugin.path, 'manifest.json'), 'utf8')) as { id: string; version: string };
        if (manifest.version !== plugin.version) throw new Error('Plugin source and composition versions differ.');
        archived.push({ id: manifest.id, version: manifest.version, enabled: plugin.enabled });
      }
      const signature = (value: unknown) => JSON.stringify(value, ['id', 'version', 'enabled']);
      if (!Array.isArray(installed) || signature(installed) !== signature(archived)) throw new Error('Source composition differs from the installed database. Back up from the currently installed release.');
      const tables = await tx`select table_schema,table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE' order by table_schema,table_name`;
      const [version] = await tx`select version() as value`;
      const value: BackupMetadata = { format: 1, createdAt: (options.now ?? new Date()).toISOString(), kind: options.kind ?? 'manual', encryptionKeyFingerprint, postgresVersion: version.value, migrations: migrations.map(row => ({ plugin_id: row.plugin_id, name: row.name, checksum: row.checksum })), tables: tables.map(row => `${row.table_schema}.${row.table_name}`), composition: archived, publicConfiguration: { appOrigin: process.env.APP_ORIGIN ?? null, cookieSecure: process.env.COOKIE_SECURE !== 'false' } };
      const releaseIdentity = process.env.ATHLETE_PANEL_RELEASE_IDENTITY;
      if (releaseIdentity) {
        const identity = releasedImageSchema.parse(JSON.parse(releaseIdentity));
        const built = await readImageMetadata(root);
        if (identity.sourceDigest !== built.sourceDigest || identity.version !== built.version || await sourceDigest(join(stage, 'source')) !== built.sourceDigest) throw new Error('Backup source differs from the installed image metadata.');
        value.release = identity;
      }
      await pgCommand('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', join(stage, 'database.dump')], options.databaseUrl, options.pgBinDirectory);
      return value;
    });
    await writeFile(join(stage, 'metadata.json'), JSON.stringify(metadata), { mode: 0o600 });
    await verifyStorage(options.destination);
    await mkdir(options.destination, { recursive: true, mode: 0o700 });
    const filename = `athlete-panel-${metadata.kind}-${metadata.createdAt.replaceAll(':', '-')}-${randomUUID()}.fgr`;
    const file = join(resolve(options.destination), filename);
    partial = `${file}.partial`;
    const iv = randomBytes(12);
    await writeFile(partial, Buffer.concat([BACKUP_MAGIC, iv]), { flag: 'wx', mode: 0o600 });
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const entries = [{ path: 'metadata.json', file: join(stage, 'metadata.json') }, { path: 'database.dump', file: join(stage, 'database.dump') }, ...await sourceFiles(join(stage, 'source'))];
    await pipeline(Readable.from(archive(entries)), createGzip(), cipher, createWriteStream(partial, { flags: 'a', mode: 0o600 }));
    await appendFile(partial, cipher.getAuthTag());
    const completeArchive = await open(partial, 'r');
    try { await completeArchive.sync(); } finally { await completeArchive.close(); }
    // Read the destination back before publishing a completed archive name.
    const { verifyBackup } = await import('./restore');
    const verified = await verifyBackup(partial, options.keyFile, options.encryptionKey);
    await verified.cleanup();
    const storage = await verifyStorage(options.destination);
    await rename(partial, file); partial = null;
    const directory = await open(resolve(options.destination), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    // Publish health only after the archive has a completed authenticated form at its final path.
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(736147001)`;
      await tx`insert into host.settings(key,value) values ('lastBackup',${tx.json({ completedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), storage, file: basename(file), kind: metadata.kind })}) on conflict(key) do update set value=excluded.value`;
    });
    return { file, metadata };
  } finally {
    key.fill(0); await sql.end(); await rm(stage, { recursive: true, force: true });
    if (partial) await rm(partial, { force: true });
  }
}

function weekKey(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const first = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return `${copy.getUTCFullYear()}-${Math.ceil(((copy.getTime() - first.getTime()) / 86_400_000 + 1) / 7)}`;
}
export async function pruneDailyBackups(destination: string): Promise<number> {
  const candidates = (await readdir(destination)).flatMap(name => {
    const match = /^athlete-panel-daily-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-[a-f0-9-]+\.fgr$/.exec(name);
    if (!match) return [];
    const date = new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'));
    return Number.isFinite(date.getTime()) ? [{ name, date }] : [];
  }).sort((a, b) => b.date.getTime() - a.date.getTime());
  const keep = new Set<string>(), days = new Set<string>(), weeks = new Set<string>();
  for (const item of candidates) {
    const day = item.date.toISOString().slice(0, 10), week = weekKey(item.date);
    if (days.size < 7 && !days.has(day)) { days.add(day); keep.add(item.name); }
    if (weeks.size < 4 && !weeks.has(week)) { weeks.add(week); keep.add(item.name); }
  }
  const remove = candidates.filter(item => !keep.has(item.name));
  for (const item of remove) await rm(join(destination, item.name));
  return remove.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--daily')) throw new Error('Usage: pnpm exec tsx scripts/backup.ts [--daily]');
  const result = await createBackup({ databaseUrl: process.env.DATABASE_URL ?? '', keyFile: process.env.BACKUP_KEY_FILE ?? '', encryptionKey: process.env.ENCRYPTION_KEY ?? '', destination: process.env.BACKUP_DESTINATION ?? 'backups', kind: process.argv.includes('--daily') ? 'daily' : 'manual' });
  if (result.metadata.kind === 'daily') await pruneDailyBackups(resolve(process.env.BACKUP_DESTINATION ?? 'backups'));
  console.log(`Encrypted backup completed: ${result.file}`);
}
