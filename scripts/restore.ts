import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import postgres from 'postgres';
import {
  BACKUP_MAGIC,
  decodeKey,
  loadBackupKey,
  pgCommand,
  type BackupMetadata,
} from './lib/backup-format';
import { releasedImageSchema } from './lib/release-data';
import { sourceDigest } from './lib/source-files';

export type RestoreOptions = {
  file: string;
  keyFile: string;
  encryptionKey: string;
  databaseUrl: string;
  sourceDirectory: string;
  confirmReplace: boolean;
  pgBinDirectory?: string;
};

async function unpack(archive: string, destination: string, signal?: AbortSignal): Promise<void> {
  const input = await open(archive, 'r');
  const length = (await input.stat()).size;
  let offset = 0;
  const seen = new Set<string>();
  try {
    while (offset < length) {
      signal?.throwIfAborted();
      const bytes: number[] = [];
      while (offset < length) {
        const byte = Buffer.alloc(1);
        await input.read(byte, 0, 1, offset++);
        if (byte[0] === 10) break;
        bytes.push(byte[0]);
        if (bytes.length > 4096) throw new Error('Invalid archive entry header.');
      }
      const header = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
        end?: boolean;
        path?: string;
        size?: number;
        sha256?: string;
      };
      if (header.end === true) {
        if (offset !== length) throw new Error('Unexpected trailing archive content.');
        return;
      }
      const path = header.path;
      if (
        typeof path !== 'string' ||
        path.includes('\\') ||
        /[\0\r\n]/.test(path) ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        (!['metadata.json', 'database.dump'].includes(path) && !path.startsWith('source/')) ||
        seen.has(path)
      )
        throw new Error('Unsafe or duplicate archive path.');
      if (
        !Number.isSafeInteger(header.size) ||
        header.size! < 0 ||
        header.size! > 512 * 1024 ** 3 ||
        offset + header.size! > length ||
        !/^[a-f0-9]{64}$/.test(header.sha256 ?? '')
      )
        throw new Error('Invalid archive file size or checksum.');
      seen.add(path);
      const target = join(destination, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256');
      if (header.size! > 0)
        await pipeline(
          createReadStream(archive, { start: offset, end: offset + header.size! - 1 }),
          new Transform({
            transform(chunk, _encoding, callback) {
              hash.update(chunk);
              callback(null, chunk);
            },
          }),
          createWriteStream(target, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
      else {
        const file = await open(target, 'wx', 0o600);
        await file.close();
      }
      if (hash.digest('hex') !== header.sha256) throw new Error('Archive file checksum mismatch.');
      offset += header.size!;
    }
    throw new Error('The archive ended without its completion marker.');
  } finally {
    await input.close();
  }
}

export async function verifyBackup(
  file: string,
  keyFile: string,
  encryptionKey: string,
  stageParentDirectory = tmpdir(),
  signal?: AbortSignal,
): Promise<{ stage: string; metadata: BackupMetadata; cleanup: () => Promise<void> }> {
  const key = await loadBackupKey(keyFile);
  const stage = await mkdtemp(join(stageParentDirectory, 'athlete-panel-restore-'));
  await chmod(stage, 0o700);
  const cleanup = () => rm(stage, { recursive: true, force: true });
  try {
    const input = await open(file, 'r');
    const size = (await input.stat()).size;
    const header = Buffer.alloc(BACKUP_MAGIC.length + 12),
      tag = Buffer.alloc(16);
    try {
      if (size <= header.length + tag.length) throw new Error('Invalid or truncated backup.');
      await input.read(header, 0, header.length, 0);
      await input.read(tag, 0, 16, size - 16);
      if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC))
        throw new Error('Unsupported backup format.');
    } finally {
      await input.close();
    }
    const headerLength = header.length;
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(BACKUP_MAGIC.length));
    decipher.setAuthTag(tag);
    const archive = join(stage, 'archive.stream');
    try {
      await pipeline(
        createReadStream(file, { start: headerLength, end: size - 17 }),
        decipher,
        createGunzip(),
        createWriteStream(archive, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
    } catch {
      signal?.throwIfAborted();
      throw new Error(
        'Backup authentication failed: wrong backup key, corruption or incomplete archive. Nothing was restored.',
      );
    }
    // Do not inspect/extract or touch the target database until the entire GCM tag authenticated.
    const extracted = join(stage, 'extracted');
    await mkdir(extracted, { mode: 0o700 });
    await unpack(archive, extracted, signal);
    const metadata = JSON.parse(
      await readFile(join(extracted, 'metadata.json'), 'utf8'),
    ) as BackupMetadata;
    if (
      metadata.format !== 1 ||
      !Array.isArray(metadata.migrations) ||
      !Array.isArray(metadata.composition) ||
      !Array.isArray(metadata.tables) ||
      !metadata.tables.includes('host.settings') ||
      metadata.tables.some((table) => typeof table !== 'string') ||
      !/^[a-f0-9]{64}$/.test(metadata.encryptionKeyFingerprint)
    )
      throw new Error('Invalid backup metadata.');
    const fingerprint = createHash('sha256')
      .update(decodeKey(encryptionKey, 'Application encryption key'))
      .digest('hex');
    if (metadata.encryptionKeyFingerprint !== fingerprint)
      throw new Error(
        'The application ENCRYPTION_KEY does not match this backup. Nothing was restored.',
      );
    if (metadata.release !== undefined) {
      metadata.release = releasedImageSchema.parse(metadata.release);
      if ((await sourceDigest(join(extracted, 'source'))) !== metadata.release.sourceDigest)
        throw new Error('Archived source differs from its recorded image.');
    }
    for (const migration of metadata.migrations) {
      if (
        typeof migration.name !== 'string' ||
        migration.name.startsWith('/') ||
        migration.name.split('/').includes('..')
      )
        throw new Error('Invalid migration metadata.');
      const source = await readFile(join(extracted, 'source', migration.name));
      if (createHash('sha256').update(source).digest('hex') !== migration.checksum)
        throw new Error('Archived source does not match its database migrations.');
    }
    await stat(join(extracted, 'database.dump'));
    return { stage: extracted, metadata, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    key.fill(0);
  }
}

export async function restoreBackup(options: RestoreOptions): Promise<BackupMetadata> {
  if (!options.confirmReplace)
    throw new Error(
      'Restore replaces the target database. Supply --confirm-replace only after stopping its web and worker services.',
    );
  if (!options.sourceDirectory) throw new Error('A new source directory is required.');
  const url = new URL(options.databaseUrl);
  if (['postgres', 'template0', 'template1'].includes(decodeURIComponent(url.pathname.slice(1))))
    throw new Error('Refusing to restore into a PostgreSQL administrative database.');
  const verified = await verifyBackup(options.file, options.keyFile, options.encryptionKey);
  const sql = postgres(options.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const destination = resolve(options.sourceDirectory);
    const existing = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing)
      throw new Error(
        'Restore source directory already exists. Select a new directory; existing code is never overwritten.',
      );
    const tables =
      await sql`select table_schema,table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'`;
    if (tables.length) {
      if (!tables.some((row) => row.table_schema === 'host' && row.table_name === 'settings'))
        throw new Error(
          'Refusing to replace a database not recognized as Athlete Panel. Use a fresh empty database.',
        );
      const [maintenance] = await sql`select value from host.settings where key='maintenance'`;
      if (maintenance?.value !== true)
        throw new Error(
          'Enable maintenance and stop web/worker before replacing an existing instance.',
        );
      const expectedTables = new Set(verified.metadata.tables);
      if (tables.some((row) => !expectedTables.has(`${row.table_schema}.${row.table_name}`)))
        throw new Error(
          'Target contains tables not represented by this backup. Restore into a fresh empty database.',
        );
    }
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(destination, { mode: 0o700 });
    // The directory was reserved exclusively above. Copy its children, not the
    // already-existing root: newer Node 22 releases reject that root with EEXIST.
    for (const name of await readdir(join(verified.stage, 'source'))) {
      await cp(join(verified.stage, 'source', name), join(destination, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    await pgCommand(
      'pg_restore',
      [
        '--dbname',
        decodeURIComponent(url.pathname.slice(1)),
        '--single-transaction',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        join(verified.stage, 'database.dump'),
      ],
      options.databaseUrl,
      options.pgBinDirectory,
    );
    await sql.begin(async (tx) => {
      const migrations =
        await tx`select plugin_id,name,checksum from host.migrations order by plugin_id,name`;
      if (
        JSON.stringify(
          migrations.map((row) => ({
            plugin_id: row.plugin_id,
            name: row.name,
            checksum: row.checksum,
          })),
        ) !== JSON.stringify(verified.metadata.migrations)
      )
        throw new Error(
          'Restored migration journal differs from the archive metadata. Keep the instance offline.',
        );
      await tx`insert into host.settings(key,value) values('maintenance','true'::jsonb) on conflict(key) do update set value='true'::jsonb`;
      await tx`delete from host.sessions`;
      await tx`delete from host.settings where key in ('worker','lastBackup','backupAttempt','backupSchedule','backupNotification')`;
      await tx`update host.grants set revoked=true`;
      await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null where status='running'`;
    });
    return verified.metadata;
  } finally {
    await sql.end();
    await verified.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    file = args[0];
  const directoryIndex = args.indexOf('--source-dir');
  const sourceDirectory = directoryIndex >= 0 ? args[directoryIndex + 1] : null;
  if (
    !file ||
    !sourceDirectory ||
    args.some(
      (argument, index) =>
        index > 0 &&
        argument !== '--confirm-replace' &&
        argument !== '--source-dir' &&
        index !== directoryIndex + 1,
    )
  )
    throw new Error(
      'Usage: pnpm exec tsx scripts/restore.ts <archive.fgr> --confirm-replace --source-dir <new-directory>',
    );
  const metadata = await restoreBackup({
    file,
    sourceDirectory,
    confirmReplace: args.includes('--confirm-replace'),
    databaseUrl: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    keyFile: process.env.BACKUP_KEY_FILE ?? '',
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  });
  console.log(
    `Restored backup ${metadata.createdAt}. Maintenance remains ON. Use the restored source and matching secrets, verify schema/build/health, then explicitly disable maintenance.`,
  );
}
