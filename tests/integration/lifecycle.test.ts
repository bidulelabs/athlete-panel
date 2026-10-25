import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registry, schemaSignature } from '../../instance/registry.metadata';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { claimJob } from '../../packages/host/src/jobs';
import { migrate } from '../../packages/host/src/migrations';
import { checkSchema } from '../../packages/host/src/schema';

const suppliedUrl = process.env.TEST_DATABASE_URL;
if (!suppliedUrl) throw new Error('Lifecycle tests require explicit TEST_DATABASE_URL for isolated local *_test storage.');
const base = new URL(suppliedUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !base.pathname.endsWith('_test')) throw new Error('Lifecycle tests require an explicit localhost *_test database.');
const admin = postgres(suppliedUrl, { max: 1, onnotice: () => {} });
const originalDatabaseUrl = process.env.DATABASE_URL;
const migrationFiles = ['packages/host/migrations/001-host.sql', ...registry.filter(entry => entry.enabled).flatMap(entry => entry.manifest.migrations.map(file => `${entry.path}/${file}`))];
let root: string, databaseName: string;

describe('transactional migration and source lifecycle', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'athlete-panel-lifecycle-')); await chmod(root, 0o700);
    for (const file of migrationFiles) {
      await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
      await writeFile(join(root, file), await readFile(resolve(file)), { mode: 0o600 });
    }
  });
  beforeEach(async () => {
    await closeDatabase();
    databaseName = `athlete-panel_lifecycle_${randomUUID().replaceAll('-', '')}_test`;
    await admin.unsafe(`create database "${databaseName}"`);
    const url = new URL(base); url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
  });
  afterEach(async () => {
    await closeDatabase();
    if (databaseName) await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  });
  afterAll(async () => {
    await admin.end();
    if (root) await rm(root, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rolls back every schema and migration journal entry when a late migration fails', async () => {
    const last = join(root, migrationFiles.at(-1)!);
    const original = await readFile(last, 'utf8');
    try {
      await writeFile(last, `${original}\nselect * from lifecycle_deliberate_failure;\n`);
      await expect(migrate(root)).rejects.toThrow('lifecycle_deliberate_failure');
      expect(await connection()`select schema_name from information_schema.schemata where schema_name in ('host','athlete','training','activity_records','garmin')`).toHaveLength(0);
    } finally { await writeFile(last, original); }
    await migrate(root);
    await expect(checkSchema()).resolves.toBeUndefined();
    expect(await connection()`select name from host.migrations`).toHaveLength(migrationFiles.length);
  });

  it('refuses an incompatible schema signature or composition until the installed values match', async () => {
    await migrate(root);
    const [installed] = await connection()`select value from host.settings where key='composition'`;
    await connection()`update host.settings set value='"another-artifact"'::jsonb where key='schemaSignature'`;
    await expect(checkSchema()).rejects.toThrow('not supported');
    await connection()`update host.settings set value=${connection().json(schemaSignature)} where key='schemaSignature'`;
    await connection()`update host.settings set value='[]'::jsonb where key='composition'`;
    await expect(checkSchema()).rejects.toThrow('composition/schema differs');
    await connection()`update host.settings set value=${connection().json(installed.value)} where key='composition'`;
    await expect(checkSchema()).resolves.toBeUndefined();
  });

  it('distinguishes a post-commit permission failure and safely retries the committed migration', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_DATABASE_PASSWORD: 'invalid-password' };
    delete env.ADMIN_DATABASE_URL;
    const failed = spawnSync(process.execPath, ['--import','tsx','scripts/migrate.ts'], { env, encoding:'utf8' });
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('Migrations committed');
    expect(failed.stderr).not.toContain('invalid-password');
    const before = await connection()`select name,checksum from host.migrations order by name`;
    expect(before.length).toBeGreaterThan(0);
    const retry = spawnSync(process.execPath, ['--import','tsx','scripts/migrate.ts'], { env:{...env,APP_DATABASE_PASSWORD:'a'.repeat(64)}, encoding:'utf8' });
    expect(retry.status).toBe(0);
    expect(await connection()`select name,checksum from host.migrations order by name`).toEqual(before);
  });

  it('verifies retained migration files even after their plugin leaves the active composition', async () => {
    await migrate(root);
    const file = 'personal-plugins/retired-fixture/migrations/001.sql';
    const original = 'create schema retired_fixture;';
    await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
    await writeFile(join(root, file), original, { mode: 0o600 });
    await connection().unsafe(original);
    await connection()`insert into host.migrations(plugin_id,name,checksum) values('retired-fixture',${file},${createHash('sha256').update(original).digest('hex')})`;
    const before = await connection()`select key,value from host.settings order by key`;
    await writeFile(join(root, file), `${original}\nselect 1;`);
    await expect(migrate(root)).rejects.toThrow('Retained migration checksum mismatch');
    expect(await connection()`select key,value from host.settings order by key`).toEqual(before);
    await writeFile(join(root, file), original);
    await migrate(root);
    expect(await connection()`select name from host.migrations where plugin_id='retired-fixture'`).toHaveLength(1);
    await rm(join(root, file));
    await expect(migrate(root)).rejects.toThrow();
  });

  it('clears unavailable-plugin leases without deleting checkpoints and resumes enabled retained work', async () => {
    await migrate(root);
    const disabledId = randomUUID(), resumedId = randomUUID();
    const payload = { checkpoint: 'synthetic-retained-position', page: 42 };
    await connection()`insert into host.jobs(id,plugin_id,kind,status,payload,lease_owner,lease_until) values
      (${disabledId},'removed-personal-plugin','sync','running',${connection().json(payload)},'old-worker',now()+interval '1 hour'),
      (${resumedId},'garmin','garmin-history','disabled',${connection().json(payload)},null,null)`;
    const job = await claimJob('new-worker');
    expect(job).toMatchObject({ id: resumedId, payload, lease_owner: 'new-worker' });
    const [disabled] = await connection()`select status,payload,lease_owner,lease_until from host.jobs where id=${disabledId}`;
    expect(disabled).toEqual({ status: 'disabled', payload, lease_owner: null, lease_until: null });
  });
});
