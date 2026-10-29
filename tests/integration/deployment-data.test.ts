import { randomUUID } from 'node:crypto';
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
  try {
    await admin.unsafe(`create database "${database}"`);
    await closeDatabase();
    process.env.DATABASE_URL = url.toString();
    await migrate();
    await expect(verifyData()).rejects.toThrow('exactly one owner');
    await bootstrapOwner('synthetic-deployment-validation');
    await expect(verifyData()).resolves.toBeUndefined();
    const sql = connection();
    await sql`insert into training.records(kind,id,revision,data) values('workout',${randomUUID()},1,'{}')`;
    await expect(verifyData()).rejects.toThrow();
    await sql`delete from training.records`;
    await expect(verifyData()).resolves.toBeUndefined();
    await sql`update host.migrations set checksum=repeat('0',64) where name=(select min(name) from host.migrations)`;
    await expect(verifyData()).rejects.toThrow();
  } finally {
    await closeDatabase();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
    await admin.end();
  }
});
