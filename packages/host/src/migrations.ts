import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connection } from './db';
import { registry, schemaSignature } from '../../../instance/registry.metadata';
import { validateComposition, manifestSchema } from '../../plugin-sdk/src';
import { hostMigrationFiles } from './migration-files';

export async function validateRetainedMigrations(
  root: string,
  applied: Array<{ name: string; checksum: string }>,
) {
  for (const row of applied) {
    if (
      !/^(packages\/host|plugins\/[a-z0-9-]+|personal-plugins\/[a-z0-9-]+)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(
        row.name,
      ) ||
      row.name.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('Invalid applied migration path.');
    const body = await readFile(resolve(root, row.name), 'utf8');
    if (createHash('sha256').update(body).digest('hex') !== row.checksum)
      throw new Error(`Retained migration checksum mismatch: ${row.name}`);
  }
}

export async function migrate(root = process.cwd()) {
  const sql = connection();
  const manifests = registry.map((e) => manifestSchema.parse(e.manifest));
  const ordered = validateComposition(
    manifests,
    registry.filter((e) => e.enabled).map((e) => e.manifest.id),
  );
  const sources = [
    { id: 'host', files: hostMigrationFiles },
    ...ordered.map((m) => ({
      id: m.id,
      files: m.migrations.map((f) => `${registry.find((e) => e.manifest.id === m.id)!.path}/${f}`),
    })),
  ];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147002)`;
    await tx`create schema if not exists host`;
    await tx`create table if not exists host.migrations (plugin_id text not null,name text not null,checksum text not null,applied_at timestamptz not null default now(),primary key(plugin_id,name))`;
    await validateRetainedMigrations(
      root,
      await tx<{ name: string; checksum: string }[]>`select name,checksum from host.migrations`,
    );
    for (const source of sources)
      for (const file of source.files) {
        const body = await readFile(resolve(root, file), 'utf8');
        const checksum = createHash('sha256').update(body).digest('hex');
        const [old] =
          await tx`select checksum from host.migrations where plugin_id=${source.id} and name=${file}`;
        if (old) {
          if (old.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${file}`);
          continue;
        }
        await tx.unsafe(body).catch((error: { code: string }) => {
          throw new Error(`Migration ${file} failed with SQLSTATE ${error.code}.`);
        });
        await tx`insert into host.migrations(plugin_id,name,checksum) values (${source.id},${file},${checksum})`;
      }
    await tx`insert into host.settings(key,value) values ('composition',${tx.json(registry.map((e) => ({ id: e.manifest.id, version: e.manifest.version, enabled: e.enabled })))}) on conflict(key) do update set value=excluded.value`;
    await tx`insert into host.settings(key,value) values('schemaSignature',${tx.json(schemaSignature)}) on conflict(key) do update set value=excluded.value`;
  });
}
