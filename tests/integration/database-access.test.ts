import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { expect, it } from 'vitest';
import { provisionApplicationRole } from '../../packages/host/src/database-access';

it('keeps runtime data access while denying role, schema, owner and migration administration', async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('Explicit isolated TEST_DATABASE_URL required.');
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(source.hostname) || !source.pathname.endsWith('_test'))
    throw new Error('Use a loopback *_test database.');
  const admin = postgres(source.href, { max: 1, onnotice: () => {} });
  const suffix = randomBytes(6).toString('hex'),
    name = `roles_${suffix}_test`,
    role = `app_${suffix}`,
    password = randomBytes(32).toString('hex');
  let db: ReturnType<typeof postgres> | undefined, app: ReturnType<typeof postgres> | undefined;
  try {
    await admin`create database ${admin(name)}`;
    const target = new URL(source);
    target.pathname = `/${name}`;
    db = postgres(target.href, { max: 1, onnotice: () => {} });
    await db`create schema host`;
    await db`create table host.owner(id text primary key)`;
    await db`create table host.migrations(id text primary key)`;
    await db`create table host.records(id text primary key)`;
    await provisionApplicationRole(db, password, role);
    target.username = role;
    target.password = password;
    app = postgres(target.href, { max: 1, onnotice: () => {} });
    await app`insert into host.records values ('synthetic-record')`;
    expect(await app`select * from host.records`).toHaveLength(1);
    await app`update host.records set id='updated'`;
    await app`delete from host.records`;
    const [flags] =
      await app`select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user`;
    expect(Object.values(flags)).toEqual([false, false, false, false]);
    for (const query of [
      'create schema forbidden',
      'create role forbidden',
      'create temp table forbidden(id int)',
      'truncate host.records',
      "insert into host.owner values ('changed')",
      'delete from host.migrations',
    ]) {
      await expect(app.unsafe(query)).rejects.toMatchObject({ code: '42501' });
    }
    // A later plugin migration gets permissions on the next explicit provisioning pass.
    await db`create schema new_plugin`;
    await db`create table new_plugin.records(id text)`;
    await provisionApplicationRole(db, password, role);
    await expect(app`insert into new_plugin.records values ('new')`).resolves.toBeDefined();
  } finally {
    await app?.end();
    await db?.end();
    await admin`drop database if exists ${admin(name)} with (force)`;
    await admin`drop role if exists ${admin(role)}`;
    await admin.end();
  }
});
