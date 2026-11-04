import { isolatedDatabaseUrl } from '../support/test-database';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registry, schemaSignature } from '../../instance/registry.metadata';
import { loadWorkspace } from '../../instance/services';
import { canonical, digest } from '../../packages/host/src/crypto';
import { boundedContext } from '../../plugins/agent-bridge/proposal-validation';
import { applyCommands } from '../../plugins/training/public/server';
import { agentCommandsSchema } from '../../packages/contracts/src';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { claimJob } from '../../packages/host/src/jobs';
import { migrate } from '../../packages/host/src/migrations';
import { checkSchema } from '../../packages/host/src/schema';
import { hostMigrationFiles } from '../../packages/host/src/migration-files';
import { createGrant, contextForToken, reviewProposal } from '../../plugins/agent-bridge/service';
import { readHistory } from '../../plugins/agent-bridge/history';
import { syntheticDay } from '../fixtures/historical';
import { provisionApplicationRole } from '../../packages/host/src/database-access';
import mainMigrations from '../fixtures/main-migrations.json';

const suppliedUrl = isolatedDatabaseUrl();
const base = new URL(suppliedUrl);
const admin = postgres(suppliedUrl, { max: 1, onnotice: () => {} });
const originalDatabaseUrl = process.env.DATABASE_URL;
const migrationFiles = [
  ...hostMigrationFiles,
  ...registry
    .filter((entry) => entry.enabled)
    .flatMap((entry) => entry.manifest.migrations.map((file) => `${entry.path}/${file}`)),
];
let root: string, databaseName: string;

describe('transactional migration and source lifecycle', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'athlete-panel-lifecycle-'));
    await chmod(root, 0o700);
    for (const file of migrationFiles) {
      await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
      await writeFile(join(root, file), await readFile(resolve(file)), { mode: 0o600 });
    }
  });
  beforeEach(async () => {
    await closeDatabase();
    databaseName = `athlete-panel_lifecycle_${randomUUID().replaceAll('-', '')}_test`;
    await admin.unsafe(`create database "${databaseName}"`);
    const url = new URL(base);
    url.pathname = `/${databaseName}`;
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
      await expect(migrate(root)).rejects.toThrow(
        `Migration ${migrationFiles.at(-1)} failed with SQLSTATE 42P01.`,
      );
      expect(
        await connection()`select schema_name from information_schema.schemata where schema_name in ('host','athlete','training','activity_records','garmin')`,
      ).toHaveLength(0);
    } finally {
      await writeFile(last, original);
    }
    await migrate(root);
    await expect(checkSchema()).resolves.toBeUndefined();
    expect(await connection()`select name from host.migrations`).toHaveLength(
      migrationFiles.length,
    );
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

  it('upgrades the main schema without rewriting its records, grants or proposal snapshots', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const sql = connection();
    await sql`create schema host`;
    await sql`create table host.migrations(plugin_id text not null,name text not null,checksum text not null,applied_at timestamptz not null default now(),primary key(plugin_id,name))`;
    const baseline = migrationFiles.filter((file) => mainMigrations.files.includes(file));
    expect(baseline).toHaveLength(mainMigrations.files.length);
    for (const file of baseline) {
      const body = await readFile(file, 'utf8');
      await sql.unsafe(body);
      const pluginId = file.startsWith('packages/host/') ? 'host' : file.split('/')[1]!;
      await sql`insert into host.migrations(plugin_id,name,checksum) values(${pluginId},${file},${createHash('sha256').update(body).digest('hex')})`;
    }
    const activity = syntheticDay('2024-01-02', 0).activities[0]!;
    await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${activity.id},1,${sql.json(activity)})`;
    await sql`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,scanned_at) values('activities','2024-01-01','2024-01-31','complete','scanned',now())`;
    const access = await createGrant({
      label: 'Pre-upgrade access',
      from: '2024-01-01',
      to: '2024-03-31',
    });
    // Seed the pre-upgrade v2 proposal on its own schema, before planning_reads exists.
    const scope = { from: '2024-01-01', to: '2024-03-31', includeNotes: false };
    const state = await loadWorkspace(undefined, scope);
    const snapshotState = boundedContext(state, scope);
    const readDigest = digest(canonical(snapshotState));
    const summary = 'Pending before upgrade';
    const commands = agentCommandsSchema.parse([
      {
        action: 'plan.create',
        values: { id: randomUUID(), title: 'Synthetic pending plan', startDate: '2024-03-01' },
      },
    ]);
    const { changes } = applyCommands(state, commands, { actor: 'agent' });
    const proposal = {
      id: randomUUID(),
      digest: digest(canonical({ commands, changes, contextDigest: readDigest, summary })),
    };
    await sql`insert into host.proposals(id,grant_id,status,summary,commands,changes,context,digest)
      values(${proposal.id},${access.grant.id},'pending',${summary},${sql.json(commands as never)},${sql.json(changes as never)},
        ${sql.json({ version: 2, scope, digest: readDigest, snapshot: snapshotState } as never)},${proposal.digest})`;
    const [snapshot] = await sql`select context from host.proposals where id=${proposal.id}`;
    expect(snapshot.context.version).toBe(2);
    const legacyId = randomUUID();
    await sql`insert into host.proposals(id,grant_id,status,summary,commands,changes,context,digest)
      select ${legacyId},grant_id,status,summary,commands,changes,context-'version'-'snapshot',digest
      from host.proposals where id=${proposal.id}`;
    const before = {
      records: await sql`select * from activity_records.records`,
      grants: await sql`select * from host.grants`,
      proposals: await sql`select * from host.proposals order by id`,
      migrations: await sql`select name,checksum from host.migrations order by name`,
    };
    await migrate(root);
    expect(await sql`select * from activity_records.records`).toEqual(before.records);
    expect(await sql`select * from host.grants`).toEqual(before.grants);
    expect(await sql`select * from host.proposals order by id`).toEqual(before.proposals);
    expect(
      await sql`select name,checksum from host.migrations where name=any(${baseline}) order by name`,
    ).toEqual(before.migrations);
    expect((await contextForToken(access.token)).scope).toEqual({
      from: '2024-01-01',
      to: '2024-03-31',
      includeNotes: false,
    });
    for (const id of [proposal.id, legacyId])
      expect((await reviewProposal({ id, digest: proposal.digest })).applicability).toBe('ready');
    await expect(readHistory(access.token, 'discover')).rejects.toMatchObject({ status: 403 });
    const historyAccess = await createGrant({
      label: 'Fresh history',
      version: 2,
      planning: null,
      history: {
        from: '2024-01-01',
        to: '2024-12-31',
        categories: ['activities'],
        weekStartsOn: 1,
      },
    });
    const restarted = await readHistory(historyAccess.token, 'records', { category: 'activities' });
    const currentVersion = (await sql`select revision from activity_records.history_version`)[0]!
      .revision;
    const role = `history_runtime_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    let runtime: ReturnType<typeof postgres> | undefined;
    try {
      await provisionApplicationRole(sql, password, role);
      const target = new URL(process.env.DATABASE_URL!);
      target.username = role;
      target.password = password;
      runtime = postgres(target.href, { max: 1, onnotice: () => {} });
      await runtime`update activity_records.records set data=data`;
      expect((await sql`select revision from activity_records.history_version`)[0]!.revision).toBe(
        currentVersion,
      );
      await expect(
        readHistory(historyAccess.token, 'records', {
          ...restarted.query,
          reviewToken: restarted.reviewToken,
        }),
      ).resolves.toBeDefined();
      await runtime`update activity_records.records set revision=revision+1`;
      await expect(
        readHistory(historyAccess.token, 'records', {
          ...restarted.query,
          reviewToken: restarted.reviewToken,
        }),
      ).rejects.toMatchObject({ code: 'history_changed' });
    } finally {
      await runtime?.end();
      await sql`drop owned by ${sql(role)}`;
      await admin`drop role if exists ${admin(role)}`;
    }
    await expect(checkSchema()).resolves.toBeUndefined();
  });

  it('distinguishes a post-commit permission failure and safely retries the committed migration', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_DATABASE_PASSWORD: 'invalid-password' };
    delete env.ADMIN_DATABASE_URL;
    const failed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env,
      encoding: 'utf8',
    });
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('Migrations committed');
    expect(failed.stderr).not.toContain('invalid-password');
    const before = await connection()`select name,checksum from host.migrations order by name`;
    expect(before.length).toBeGreaterThan(0);
    const retry = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env: { ...env, APP_DATABASE_PASSWORD: 'a'.repeat(64) },
      encoding: 'utf8',
    });
    expect(retry.status).toBe(0);
    expect(await connection()`select name,checksum from host.migrations order by name`).toEqual(
      before,
    );
  });

  it('names the failing migration without the database values in the SQL error', async () => {
    const last = join(root, migrationFiles.at(-1)!);
    const original = await readFile(last, 'utf8');
    try {
      await writeFile(last, `${original}\nselect 'synthetic-private-value'::uuid;\n`);
      const failure = await migrate(root).catch((error: Error) => error.message);
      expect(failure).toBe(`Migration ${migrationFiles.at(-1)} failed with SQLSTATE 22P02.`);
    } finally {
      await writeFile(last, original);
    }
  });

  it('names the migration whose checksum no longer matches', async () => {
    await migrate(root);
    const [first] = await connection()`select name from host.migrations order by name limit 1`;
    await connection()`update host.migrations set checksum=${'0'.repeat(64)} where name=${first.name}`;
    const failed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env: process.env,
      encoding: 'utf8',
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`checksum mismatch: ${first.name}`);
  });

  it.each(['localhost', '127.0.0.1'])(
    'names the refused address when %s accepts no database connection',
    (host) => {
      const failed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
        env: { ...process.env, ADMIN_DATABASE_URL: `postgres://synthetic@${host}:1/athlete_panel` },
        encoding: 'utf8',
      });
      expect(failed.status).toBe(1);
      expect(failed.stderr.trim().split('\n').at(-1)).toContain('ECONNREFUSED 127.0.0.1:1');
    },
  );

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
    expect(
      await connection()`select name from host.migrations where plugin_id='retired-fixture'`,
    ).toHaveLength(1);
    await rm(join(root, file));
    await expect(migrate(root)).rejects.toThrow();
  });

  it('clears unavailable-plugin leases without deleting checkpoints and resumes enabled retained work', async () => {
    await migrate(root);
    const disabledId = randomUUID(),
      resumedId = randomUUID();
    const payload = { checkpoint: 'synthetic-retained-position', page: 42 };
    await connection()`insert into host.jobs(id,plugin_id,kind,status,payload,lease_owner,lease_until) values
      (${disabledId},'removed-personal-plugin','sync','running',${connection().json(payload)},'old-worker',now()+interval '1 hour'),
      (${resumedId},'garmin','garmin-history','disabled',${connection().json(payload)},null,null)`;
    const job = await claimJob('new-worker');
    expect(job).toMatchObject({ id: resumedId, payload, lease_owner: 'new-worker' });
    const [disabled] =
      await connection()`select status,payload,lease_owner,lease_until from host.jobs where id=${disabledId}`;
    expect(disabled).toEqual({ status: 'disabled', payload, lease_owner: null, lease_until: null });
  });
});
