import { isolatedDatabaseUrl } from '../support/test-database';
import { randomBytes, scryptSync } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { provisionApplicationRole } from '../../packages/host/src/database-access';
import { login, requireSession } from '../../packages/host/src/auth';
import { passwordHashAsync, verifyPasswordAsync } from '../../packages/host/src/crypto';

const supplied = isolatedDatabaseUrl();
const original = process.env.DATABASE_URL;
const suffix = randomBytes(6).toString('hex');
const name = `password_${suffix}_test`,
  role = `password_${suffix}`;
const admin = postgres(supplied, { max: 1, onnotice: () => {} });
const target = new URL(supplied);
target.pathname = `/${name}`;
const owner = postgres(target.href, { max: 3, onnotice: () => {} });
const password = 'synthetic-legacy-password';
const salt = '0123456789abcdef0123456789abcdef';
const legacy = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const app = new URL(target);
app.username = role;
app.password = randomBytes(32).toString('hex');

beforeAll(async () => {
  await admin`create database ${admin(name)}`;
  await closeDatabase();
  process.env.DATABASE_URL = target.href;
  await migrate();
  await provisionApplicationRole(owner, app.password, role);
  await closeDatabase();
  process.env.DATABASE_URL = app.href;
});
beforeEach(async () => {
  await owner`truncate host.owner,host.sessions,host.login_attempts`;
  await owner`insert into host.owner(id,password_hash) values('owner',${legacy})`;
});
afterAll(async () => {
  await closeDatabase();
  await owner.end();
  await admin`drop database if exists ${admin(name)} with (force)`;
  await admin`drop role if exists ${admin(role)}`;
  await admin.end();
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
});

async function waitingForLogins(tx: postgres.TransactionSql, count: number) {
  const deadline = Date.now() + 5000;
  while (true) {
    const [waiting] =
      await tx`select count(*)::int as count from pg_locks where locktype='advisory' and objid=736147001 and database=(select oid from pg_database where datname=current_database()) and granted=false`;
    if (waiting.count >= count) return;
    if (Date.now() >= deadline) throw new Error('Login never reached final session transaction');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('upgrades only a verified legacy password using the restricted application role', async () => {
  await expect(login('incorrect')).rejects.toMatchObject({ code: 'invalid_credentials' });
  expect((await owner`select password_hash from host.owner`)[0].password_hash).toBe(legacy);
  const token = await login(password);
  await expect(requireSession(token)).resolves.toBeUndefined();
  const encoded = (await owner`select password_hash from host.owner`)[0].password_hash;
  expect(encoded).toMatch(/^scrypt\$1\$65536\$8\$2\$/);
  expect(await verifyPasswordAsync(password, encoded)).toBe(true);
  await login(password);
  expect((await owner`select password_hash from host.owner`)[0].password_hash).toBe(encoded);
  await expect(connection()`update host.owner set password_hash=${legacy}`).rejects.toMatchObject({
    code: '42501',
  });
});

it('limits the privileged function to a valid one-time compare-and-set upgrade', async () => {
  const encoded = await passwordHashAsync(password);
  const sql = connection();
  for (const [expected, replacement] of [
    [legacy, 'bad'],
    [encoded, encoded],
    [legacy + 'x', encoded],
  ]) {
    expect(
      (await sql`select host.upgrade_password_hash(${expected},${replacement}) as ok`)[0].ok,
    ).toBe(false);
  }
  expect((await sql`select host.upgrade_password_hash(${legacy},${encoded}) as ok`)[0].ok).toBe(
    true,
  );
  expect((await sql`select host.upgrade_password_hash(${legacy},${encoded}) as ok`)[0].ok).toBe(
    false,
  );
  const [permissions] =
    await owner`select proconfig,proacl::text as acl from pg_proc where oid='host.upgrade_password_hash(text,text)'::regprocedure`;
  expect(permissions.proconfig).toContain('search_path=pg_catalog, pg_temp');
  expect(permissions.acl).not.toMatch(/[{,]=X/);
  expect(permissions.acl).toContain(`${role}=X`);
});

it('allows two concurrent upgrades, bounds further checks, and revalidates the winning hash', async () => {
  let requests: Array<Promise<string>> = [];
  await owner.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    requests = [login(password, 'one'), login(password, 'two')];
    await waitingForLogins(tx, 2);
    await expect(login(password, 'three')).rejects.toMatchObject({
      code: 'login_busy',
      status: 429,
    });
  });
  const tokens = await Promise.all(requests);
  expect(new Set(tokens).size).toBe(2);
  expect(await owner`select * from host.sessions`).toHaveLength(2);
});

it('cannot restore an obsolete hash or issue an old-password session after console recovery', async () => {
  const recovered = await passwordHashAsync('synthetic-recovered-password');
  let pending: Promise<unknown>;
  await owner.begin(async (tx) => {
    // Console recovery holds this same lock while replacing credentials/revoking sessions.
    await tx`select pg_advisory_xact_lock(736147001)`;
    pending = login(password).then(
      () => ({ unexpected: true }),
      (error: unknown) => error,
    );
    await waitingForLogins(tx, 1);
    await tx`update host.owner set password_hash=${recovered} where id='owner'`;
    await tx`delete from host.sessions`;
    await tx`update host.grants set revoked=true`;
  });
  expect(await pending!).toMatchObject({ code: 'invalid_credentials' });
  expect((await owner`select password_hash from host.owner`)[0].password_hash).toBe(recovered);
  expect(await owner`select * from host.sessions`).toHaveLength(0);
  await expect(login('synthetic-recovered-password')).resolves.toEqual(expect.any(String));
});

it('rolls back the hash upgrade if session persistence fails and releases the concurrency slot', async () => {
  await owner.unsafe(
    "create function host.reject_test_session() returns trigger language plpgsql as $$ begin raise exception 'synthetic session failure'; end $$; create trigger reject_test_session before insert on host.sessions for each row execute function host.reject_test_session()",
  );
  try {
    await expect(login(password)).rejects.toThrow('synthetic session failure');
    expect((await owner`select password_hash from host.owner`)[0].password_hash).toBe(legacy);
    expect(await owner`select * from host.sessions`).toHaveLength(0);
  } finally {
    await owner.unsafe(
      'drop trigger reject_test_session on host.sessions; drop function host.reject_test_session()',
    );
  }
  await expect(login(password)).resolves.toEqual(expect.any(String));
});
