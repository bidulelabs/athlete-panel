import { requiredRow } from './rows';
import type { Sql } from 'postgres';

/** Run only from the console/admin process after migrations, never from web or worker. */
export async function provisionApplicationRole(
  sql: Sql,
  password: string,
  role = process.env.APP_DATABASE_ROLE ?? 'athlete_panel_app',
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role) || !/^[a-f0-9]{32,128}$/.test(password)) {
    throw new Error(
      'Use a dedicated runtime role and APP_DATABASE_PASSWORD containing 32–128 random hexadecimal characters.',
    );
  }
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147002)`;
    const database = requiredRow(
      await tx<
        { name: string; owner: string }[]
      >`select current_database() as name, current_user as owner`,
    );
    if (database.owner === role)
      throw new Error('Migration and application database roles must differ.');
    const [existing] = await tx`select oid from pg_roles where rolname=${role}`;
    if (existing) {
      const memberships = await tx`select 1 from pg_auth_members where member=${existing.oid}`;
      const ownership =
        await tx`select 1 from pg_namespace where nspowner=${existing.oid} union all select 1 from pg_database where datdba=${existing.oid}`;
      if (memberships.length || ownership.length)
        throw new Error(
          'Runtime role must not own schemas/databases or inherit other roles. Use a new dedicated role.',
        );
    }
    // PostgreSQL DDL does not accept password bind parameters. Quote on the server;
    // callers must never log the resulting statement or database error payload.
    const statement = requiredRow(
      await tx<
        { value: string }[]
      >`select format(${existing ? 'ALTER ROLE %I' : 'CREATE ROLE %I'} || ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',${role}::text,${password}::text) as value`,
    );
    await tx.unsafe(statement.value);
    await tx`revoke create, temporary on database ${tx(database.name)} from public`;
    await tx`revoke all on database ${tx(database.name)} from ${tx(role)}`;
    await tx`grant connect on database ${tx(database.name)} to ${tx(role)}`;
    await tx`revoke create on schema public from public`;
    const schemas =
      await tx`select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema','public')`;
    for (const { nspname } of schemas) {
      await tx`revoke all on schema ${tx(nspname)} from ${tx(role)}`;
      await tx`grant usage on schema ${tx(nspname)} to ${tx(role)}`;
      await tx`revoke all on all tables in schema ${tx(nspname)} from ${tx(role)}`;
      await tx`grant select, insert, update, delete on all tables in schema ${tx(nspname)} to ${tx(role)}`;
      await tx`grant usage, select on all sequences in schema ${tx(nspname)} to ${tx(role)}`;
    }
    await tx`revoke insert, update, delete on host.owner, host.migrations from ${tx(role)}`;
    await tx`grant execute on function host.upgrade_password_hash(text,text) to ${tx(role)}`;
  });
}

export function useAdministrativeDatabase() {
  if (process.env.ADMIN_DATABASE_URL) process.env.DATABASE_URL = process.env.ADMIN_DATABASE_URL;
}
