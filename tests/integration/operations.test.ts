import { isolatedDatabaseUrl } from '../support/test-database';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDatabase } from '../../packages/host/src/db';
import { decrypt, encrypt } from '../../packages/host/src/crypto';
import { migrate } from '../../packages/host/src/migrations';
import { createBackup, loadBackupKey, pruneDailyBackups } from '../../scripts/backup';
import { nextBackupTime } from '../../scripts/operations';
import { restoreBackup, verifyBackup } from '../../scripts/restore';
import { releaseMetadata } from '../../scripts/release-metadata';
import { BACKUP_MAGIC } from '../../scripts/lib/backup-format';

// Never fall back to the production DATABASE_URL, even when a test variable is absent.
const suppliedUrl = isolatedDatabaseUrl();
const base = new URL(suppliedUrl);
const unique = randomUUID().replaceAll('-', '');
const sourceName = `athlete_panel_ops_${unique}_source_test`,
  targetName = `athlete_panel_ops_${unique}_target_test`;
const withDatabase = (name: string) => {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
};
const sourceUrl = withDatabase(sourceName),
  targetUrl = withDatabase(targetName);
const admin = postgres(suppliedUrl, { max: 1, onnotice: () => {} });
const source = postgres(sourceUrl, { max: 1, onnotice: () => {} });
const target = postgres(targetUrl, { max: 1, onnotice: () => {} });
const originalDatabaseUrl = process.env.DATABASE_URL,
  originalEncryptionKey = process.env.ENCRYPTION_KEY;
const encryptionKey = randomBytes(32).toString('base64');
let temp: string, keyFile: string, file: string, restoredSource: string;

describe('matched encrypted backup and isolated database restore', () => {
  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'athlete-panel-operations-test-'));
    await chmod(temp, 0o700);
    keyFile = join(temp, 'backup-key');
    await writeFile(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
    await admin.unsafe(`create database "${sourceName}"`);
    await admin.unsafe(`create database "${targetName}"`);
    await closeDatabase();
    process.env.DATABASE_URL = sourceUrl;
    process.env.ENCRYPTION_KEY = encryptionKey;
    await migrate();
    await closeDatabase();
    await source`insert into host.settings(key,value) values ('operations-fixture',${source.json({ privateText: 'synthetic-private-operations-fixture', encryptedCredential: encrypt('synthetic-provider-credential') })})`;
    await source`insert into host.sessions(token_hash,expires_at) values ('synthetic-session',now()+interval '1 hour')`;
    await source`insert into host.grants(id,token_hash,label,scope,expires_at) values (${randomUUID()},'synthetic-grant','Synthetic fixture','{}',now()+interval '1 hour')`;
    await source`insert into host.jobs(id,plugin_id,kind,status,payload,lease_owner,lease_until) values (${randomUUID()},'garmin','sync','running','{}','synthetic-worker',now()+interval '1 hour')`;
    const backup = await createBackup({
      databaseUrl: sourceUrl,
      keyFile,
      encryptionKey,
      destination: join(temp, 'backups'),
      root: resolve('.'),
    });
    file = backup.file;
    restoredSource = join(temp, 'restored-source');
  }, 120_000);

  afterAll(async () => {
    await closeDatabase();
    await source.end();
    await target.end();
    // Names are generated locally and never copied from environment or archive metadata.
    await admin.unsafe(`drop database if exists "${sourceName}" with (force)`);
    await admin.unsafe(`drop database if exists "${targetName}" with (force)`);
    await admin.end();
    if (temp) await rm(temp, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('authenticates the complete archive and restores matching DB, composition, source and encrypted credentials', async () => {
    const bytes = await readFile(file);
    expect(bytes.includes(Buffer.from('synthetic-private-operations-fixture'))).toBe(false);
    expect(bytes.includes(Buffer.from(encryptionKey))).toBe(false);
    expect((await stat(file)).mode & 0o077).toBe(0);
    expect(
      (await source`select value from host.settings where key='lastBackup'`)[0].value,
    ).toMatchObject({
      kind: 'manual',
      file: expect.stringMatching(/\.fgr$/),
      completedAt: expect.any(String),
    });
    const metadata = await restoreBackup({
      file,
      keyFile,
      encryptionKey,
      databaseUrl: targetUrl,
      sourceDirectory: restoredSource,
      confirmReplace: true,
    });
    expect(metadata.release).toBeUndefined(); // Local source backups do not require an image identity.
    expect(metadata.tables).toContain('host.settings');
    const [record] = await target`select value from host.settings where key='operations-fixture'`;
    expect(record.value.privateText).toBe('synthetic-private-operations-fixture');
    expect(decrypt(record.value.encryptedCredential)).toBe('synthetic-provider-credential');
    expect(
      (await target`select value from host.settings where key='schemaSignature'`)[0].value,
    ).toBe((await source`select value from host.settings where key='schemaSignature'`)[0].value);
    expect(await readFile(join(restoredSource, 'instance/composition.json'), 'utf8')).toBe(
      await readFile('instance/composition.json', 'utf8'),
    );
    expect(
      await readFile(join(restoredSource, 'personal-plugins/cycling-sleep/manifest.json'), 'utf8'),
    ).toBe(await readFile('personal-plugins/cycling-sleep/manifest.json', 'utf8'));
    expect(await stat(join(restoredSource, '.env')).catch(() => null)).toBeNull();
    expect(await stat(join(restoredSource, '.secrets')).catch(() => null)).toBeNull();
    expect((await target`select value from host.settings where key='maintenance'`)[0].value).toBe(
      true,
    );
    expect(await target`select * from host.sessions`).toHaveLength(0);
    expect((await target`select revoked from host.grants`)[0].revoked).toBe(true);
    expect((await target`select status,lease_owner,lease_until from host.jobs`)[0]).toMatchObject({
      status: 'queued',
      lease_owner: null,
      lease_until: null,
    });
  }, 120_000);

  it('rejects unsupported, truncated and corrupted backup envelopes', async () => {
    const bytes = await readFile(file);
    expect(bytes.subarray(0, BACKUP_MAGIC.length)).toEqual(BACKUP_MAGIC);
    const invalidFile = join(temp, 'invalid.fgr');
    const invalidHeader = Buffer.from(bytes);
    invalidHeader[0] ^= 1;
    await writeFile(invalidFile, invalidHeader);
    await expect(verifyBackup(invalidFile, keyFile, encryptionKey)).rejects.toThrow(
      'Unsupported backup format',
    );
    await writeFile(invalidFile, bytes.subarray(0, BACKUP_MAGIC.length + 12 + 16));
    await expect(verifyBackup(invalidFile, keyFile, encryptionKey)).rejects.toThrow('truncated');
    const corrupted = Buffer.from(bytes);
    corrupted[corrupted.length - 1] ^= 1;
    await writeFile(invalidFile, corrupted);
    await expect(verifyBackup(invalidFile, keyFile, encryptionKey)).rejects.toThrow(
      'authentication failed',
    );
  });

  it('requires confirmation before opening a database or overwriting code', async () => {
    await expect(
      restoreBackup({
        file,
        keyFile,
        encryptionKey,
        databaseUrl: 'not-a-database-url',
        sourceDirectory: restoredSource,
        confirmReplace: false,
      }),
    ).rejects.toThrow('--confirm-replace');
    await expect(
      restoreBackup({
        file,
        keyFile,
        encryptionKey,
        databaseUrl: targetUrl,
        sourceDirectory: restoredSource,
        confirmReplace: true,
      }),
    ).rejects.toThrow('already exists');
    await expect(
      restoreBackup({
        file,
        keyFile,
        encryptionKey,
        databaseUrl: withDatabase('postgres'),
        sourceDirectory: join(temp, 'unsafe'),
        confirmReplace: true,
      }),
    ).rejects.toThrow('administrative');
  });

  it('refuses an active instance and extra target tables before any restore', async () => {
    await target`update host.settings set value='false'::jsonb where key='maintenance'`;
    await expect(
      restoreBackup({
        file,
        keyFile,
        encryptionKey,
        databaseUrl: targetUrl,
        sourceDirectory: join(temp, 'active'),
        confirmReplace: true,
      }),
    ).rejects.toThrow('maintenance');
    await target`update host.settings set value='true'::jsonb where key='maintenance'`;
    await target`create table host.unexpected (id integer)`;
    await expect(
      restoreBackup({
        file,
        keyFile,
        encryptionKey,
        databaseUrl: targetUrl,
        sourceDirectory: join(temp, 'extra'),
        confirmReplace: true,
      }),
    ).rejects.toThrow('not represented');
    await target`drop table host.unexpected`;
    expect(
      (await target`select value from host.settings where key='operations-fixture'`)[0].value
        .privateText,
    ).toBe('synthetic-private-operations-fixture');
  });

  it('fails closed for missing, wrong, exposed or tampered keys and archives', async () => {
    await expect(verifyBackup(file, join(temp, 'missing-key'), encryptionKey)).rejects.toThrow();
    const wrong = join(temp, 'wrong-key');
    await writeFile(wrong, randomBytes(32).toString('base64'), { mode: 0o600 });
    await expect(verifyBackup(file, wrong, encryptionKey)).rejects.toThrow('authentication failed');
    await chmod(wrong, 0o644);
    await expect(loadBackupKey(wrong)).rejects.toThrow('0600');
    await expect(verifyBackup(file, keyFile, randomBytes(32).toString('base64'))).rejects.toThrow(
      'ENCRYPTION_KEY does not match',
    );
    const bytes = await readFile(file);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    const tampered = join(temp, 'tampered.fgr');
    await writeFile(tampered, bytes);
    await expect(
      restoreBackup({
        file: tampered,
        keyFile,
        encryptionKey,
        databaseUrl: targetUrl,
        sourceDirectory: join(temp, 'tampered-source'),
        confirmReplace: true,
      }),
    ).rejects.toThrow('authentication failed');
    expect(await stat(join(temp, 'tampered-source')).catch(() => null)).toBeNull();
    expect(
      (await target`select value from host.settings where key='operations-fixture'`)[0].value
        .privateText,
    ).toBe('synthetic-private-operations-fixture');
  });

  it('authenticates image identity and refuses a source snapshot that drifted from its image', async () => {
    const built = await releaseMetadata(restoredSource);
    await writeFile(join(restoredSource, '.athlete-panel-release.json'), JSON.stringify(built));
    const identity = {
      imageId: 'sha256:' + 'a'.repeat(64),
      registryRef: 'ghcr.io/example/athlete-panel@sha256:' + 'b'.repeat(64),
      sourceDigest: built.sourceDigest,
      version: built.version,
      kind: 'registry',
    };
    const previous = process.env.ATHLETE_PANEL_RELEASE_IDENTITY;
    const readme = join(restoredSource, 'README.md'),
      original = await readFile(readme, 'utf8');
    try {
      process.env.ATHLETE_PANEL_RELEASE_IDENTITY = JSON.stringify(identity);
      const options = {
        databaseUrl: sourceUrl,
        keyFile,
        encryptionKey,
        destination: join(temp, 'image-backups'),
        root: restoredSource,
      };
      const backup = await createBackup(options);
      const verified = await verifyBackup(backup.file, keyFile, encryptionKey);
      try {
        expect(verified.metadata.release).toEqual(identity);
      } finally {
        await verified.cleanup();
      }
      await writeFile(readme, original + '\nsynthetic-source-drift\n');
      await expect(createBackup(options)).rejects.toThrow('Backup source differs');
      expect(
        (await readdir(options.destination)).filter((name) => name.endsWith('.fgr')),
      ).toHaveLength(1);
    } finally {
      await writeFile(readme, original);
      if (previous === undefined) delete process.env.ATHLETE_PANEL_RELEASE_IDENTITY;
      else process.env.ATHLETE_PANEL_RELEASE_IDENTITY = previous;
    }
  }, 120_000);

  it('rejects a source composition or applied migration changed since installation', async () => {
    const lastSuccessfulBackup = (
      await source`select value from host.settings where key='lastBackup'`
    )[0].value;
    const compositionPath = join(restoredSource, 'instance/composition.json');
    const original = await readFile(compositionPath, 'utf8');
    const composition = JSON.parse(original);
    composition.plugins.at(-1).enabled = false;
    await writeFile(compositionPath, JSON.stringify(composition));
    const options = {
      databaseUrl: sourceUrl,
      keyFile,
      encryptionKey,
      destination: join(temp, 'mismatched'),
      root: restoredSource,
    };
    await expect(createBackup(options)).rejects.toThrow('Source composition differs');
    await writeFile(compositionPath, original);
    await writeFile(
      join(restoredSource, 'packages/host/migrations/001-host.sql'),
      '-- synthetic changed migration',
    );
    await expect(createBackup(options)).rejects.toThrow('Source does not match');
    expect(await stat(join(temp, 'mismatched')).catch(() => null)).toBeNull();
    expect(
      (await source`select value from host.settings where key='backupAttempt'`)[0].value.state,
    ).toBe('failed');
    expect((await source`select value from host.settings where key='lastBackup'`)[0].value).toEqual(
      lastSuccessfulBackup,
    );
  }, 120_000);

  it('retains seven daily and four weekly recovery points without pruning manual archives', async () => {
    const destination = join(temp, 'retention');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(destination);
    const names: string[] = [];
    for (let age = 0; age < 45; age++) {
      const date = new Date(Date.UTC(2026, 9, 24 - age, 3));
      const name = `athlete-panel-daily-${date.toISOString().replaceAll(':', '-')}-${randomUUID()}.fgr`;
      names.push(name);
      await writeFile(join(destination, name), 'fixture');
    }
    await writeFile(join(destination, 'athlete-panel-manual-keep.fgr'), 'manual');
    await writeFile(join(destination, 'unknown.fgr'), 'unknown');
    const removed = await pruneDailyBackups(destination),
      remaining = await readdir(destination);
    expect(removed).toBeGreaterThan(30);
    expect(remaining).toEqual(
      expect.arrayContaining([
        ...names.slice(0, 7),
        'athlete-panel-manual-keep.fgr',
        'unknown.fgr',
      ]),
    );
    expect(remaining.filter((name) => /^athlete-panel-daily-/.test(name))).toHaveLength(9);
    expect(await pruneDailyBackups(destination)).toBe(0);
  });

  const startBackup = async (
    caseName: string,
    command: string[],
    pgDumpScript: string,
    stallVerificationAt = '',
  ) => {
    const fakePgBinDirectory = join(temp, `${caseName}-pg-bin`);
    const stagingTmpDirectory = join(temp, `${caseName}-staging-tmp`);
    const destination = join(temp, `${caseName}-backups`);
    const verificationStartedFile = join(temp, `${caseName}-verification-started`);
    const stallVerificationHook = join(temp, 'stall-verification.mjs');
    await mkdir(fakePgBinDirectory, { recursive: true });
    await mkdir(stagingTmpDirectory);
    await writeFile(join(fakePgBinDirectory, 'pg_dump'), pgDumpScript, { mode: 0o700 });
    await writeFile(
      stallVerificationHook,
      `import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
const isArchive = (path) => String(path).endsWith('archive.stream');
const started = () => fs.writeFileSync(process.env.VERIFICATION_STARTED_FILE, '');
const { createReadStream } = fs;
const { open } = fsPromises;
if (process.env.STALL_VERIFICATION_AT === 'read_archive')
  fs.createReadStream = (path, options) => {
    if (!isArchive(path)) return createReadStream(path, options);
    started();
    return new PassThrough();
  };
if (process.env.STALL_VERIFICATION_AT === 'open_archive')
  fsPromises.open = async (path, ...rest) => {
    if (isArchive(path)) {
      started();
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
    return open(path, ...rest);
  };
syncBuiltinESMExports();
`,
    );
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', pathToFileURL(stallVerificationHook).href, ...command],
      {
        env: {
          ...process.env,
          DATABASE_URL: sourceUrl,
          BACKUP_KEY_FILE: keyFile,
          ENCRYPTION_KEY: encryptionKey,
          BACKUP_DESTINATION: destination,
          PG_BIN_DIR: fakePgBinDirectory,
          TMPDIR: stagingTmpDirectory,
          STALL_VERIFICATION_AT: stallVerificationAt,
          VERIFICATION_STARTED_FILE: verificationStartedFile,
        },
        stdio: 'ignore',
      },
    );
    const childExitCode = new Promise((done) => child.once('exit', (code) => done(code)));
    const leftoverFiles = async () => [
      ...(await readdir(stagingTmpDirectory)).filter((name) => name.startsWith('athlete-panel-')),
      ...(await readdir(destination).catch(() => [])),
    ];
    return { child, childExitCode, stagingTmpDirectory, verificationStartedFile, leftoverFiles };
  };
  const quickPgDumpScript =
    '#!/bin/sh\nfor last; do :; done\necho synthetic-unencrypted-dump > "$last"\n';

  it.each([
    { kind: 'manual', command: ['scripts/backup.ts'], exitCode: 143 },
    { kind: 'daily', command: ['scripts/operations.ts', 'backup-loop'], exitCode: 0 },
  ])(
    'stops pg_dump, records a failed attempt and deletes the unencrypted dump on SIGTERM ($kind)',
    async ({ kind, command, exitCode }) => {
      const pidFile = join(temp, `${kind}-pg_dump.pid`);
      const backup = await startBackup(
        `${kind}-pg-dump`,
        command,
        `#!/bin/sh\necho $$ > '${pidFile}'\nfor last; do :; done\necho synthetic-unencrypted-dump > "$last"\nexec sleep 30\n`,
      );
      const hasDumpFile = async () => {
        for (const stage of await readdir(backup.stagingTmpDirectory))
          if (
            await stat(join(backup.stagingTmpDirectory, stage, 'database.dump')).catch(() => null)
          )
            return true;
        return false;
      };
      await vi.waitFor(async () => expect(await hasDumpFile()).toBe(true), { timeout: 20000 });
      const pgDumpPid = Number(await readFile(pidFile, 'utf8'));
      backup.child.kill('SIGTERM');
      expect(await backup.childExitCode).toBe(exitCode);
      expect(() => process.kill(pgDumpPid, 0)).toThrow();
      expect(await backup.leftoverFiles()).toEqual([]);
      const [attempt] = await source`select value from host.settings where key='backupAttempt'`;
      expect(attempt.value.state).toBe('failed');
    },
    30000,
  );

  it.each([
    { kind: 'manual', command: ['scripts/backup.ts'], exitCode: 143 },
    { kind: 'daily', command: ['scripts/operations.ts', 'backup-loop'], exitCode: 0 },
  ])(
    'stops verification, records a failed attempt and deletes both staging directories on SIGTERM ($kind)',
    async ({ kind, command, exitCode }) => {
      const backup = await startBackup(
        `${kind}-verification`,
        command,
        quickPgDumpScript,
        'read_archive',
      );
      await vi.waitFor(
        async () => expect(await stat(backup.verificationStartedFile)).toBeTruthy(),
        {
          timeout: 20000,
        },
      );
      backup.child.kill('SIGTERM');
      expect(await backup.childExitCode).toBe(exitCode);
      expect(await backup.leftoverFiles()).toEqual([]);
      const [attempt] = await source`select value from host.settings where key='backupAttempt'`;
      expect(attempt.value.state).toBe('failed');
    },
    30000,
  );

  it('deletes both staging directories when the manual backup is forced to exit after 10 s', async () => {
    const backup = await startBackup(
      'forced-exit',
      ['scripts/backup.ts'],
      quickPgDumpScript,
      'open_archive',
    );
    await vi.waitFor(async () => expect(await stat(backup.verificationStartedFile)).toBeTruthy(), {
      timeout: 20000,
    });
    backup.child.kill('SIGTERM');
    expect(await backup.childExitCode).toBe(143);
    expect(await backup.leftoverFiles()).toEqual([]);
  }, 40000);

  it('schedules daily backups in UTC across date boundaries', () => {
    expect(nextBackupTime(new Date('2026-10-24T02:59:59Z')).toISOString()).toBe(
      '2026-10-24T03:00:00.000Z',
    );
    expect(nextBackupTime(new Date('2026-12-31T03:00:00Z')).toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    );
    expect(() => nextBackupTime(new Date(), 24)).toThrow();
  });
});
