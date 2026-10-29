import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { expect, it } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { bootstrapOwner } from '../../packages/host/src/auth';
import { migrate } from '../../packages/host/src/migrations';
import { verifyData } from '../../scripts/lib/verify-data';

it('deployment validation rejects missing owner, invalid saved domain data and changed retained migrations', async () => {
  const supplied = isolatedDatabaseUrl();
  const admin = postgres(supplied, { max: 1, onnotice: () => {} });
  const database = 'deployment_' + randomUUID().replaceAll('-', '') + '_test';
  const url = new URL(supplied);
  url.pathname = '/' + database;
  const previous = process.env.DATABASE_URL;
  const legacy = await mkdtemp(join(tmpdir(), 'athlete-panel-legacy-validation-'));
  // Exercise the controller's actual payload against both a current image layout and
  // a protocol-1 layout without the newer console validator, without moving live source.
  for (const name of [
    'packages',
    'instance',
    'plugins',
    'personal-plugins',
    'node_modules',
    'tsconfig.json',
    'package.json',
  ]) {
    await symlink(resolve(name), join(legacy, name));
  }
  const controller = await readFile('scripts/hosted.py', 'utf8');
  const payload = /DATA_CHECK = """([\s\S]*?)"""/.exec(controller)?.[1];
  if (!payload) throw new Error('Controller data-check payload missing');
  const execute = promisify(execFile);
  const validateController = async (valid: boolean) => {
    for (const cwd of [process.cwd(), legacy]) {
      const result = execute(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', payload],
        {
          cwd,
          env: { ...process.env, DATABASE_URL: url.toString() },
        },
      );
      if (valid) await expect(result).resolves.toMatchObject({ stdout: '' });
      else await expect(result).rejects.toThrow();
    }
  };
  try {
    await admin.unsafe(`create database "${database}"`);
    await closeDatabase();
    process.env.DATABASE_URL = url.toString();
    await migrate();
    await expect(verifyData()).rejects.toThrow('exactly one owner');
    await validateController(false);
    await bootstrapOwner('synthetic-deployment-validation');
    await expect(verifyData()).resolves.toBeUndefined();
    await validateController(true);
    const sql = connection();
    await sql`insert into training.records(kind,id,revision,data) values('workout',${randomUUID()},1,'{}')`;
    await expect(verifyData()).rejects.toThrow();
    await validateController(false);
    await sql`delete from training.records`;
    await expect(verifyData()).resolves.toBeUndefined();
    await sql`update host.migrations set checksum=repeat('0',64) where name=(select min(name) from host.migrations)`;
    await expect(verifyData()).rejects.toThrow();
    await validateController(false);
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
    await admin.end();
    await rm(legacy, { recursive: true, force: true });
  }
}, 60_000);
