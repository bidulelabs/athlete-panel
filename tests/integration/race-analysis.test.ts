import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { raceAnalysisSchema } from '@athlete-panel/contracts';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { isolatedDatabaseUrl } from '../support/test-database';
import {
  analysis,
  upload,
  settings,
  updateReference,
  removeReference,
} from '../../plugins/race-analysis/service';
import plugin from '../../plugins/race-analysis/server';
import {
  courseRace,
  courseRaceId,
  syntheticGpx,
  courseReferences,
} from '../fixtures/race-analysis';

beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = isolatedDatabaseUrl();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  const sql = connection();
  await sql`truncate race_analysis.reference_efforts,race_analysis.courses,race_analysis.assets,training.records,host.idempotency cascade`;
  const race = courseRace();
  await sql`insert into training.records(kind,id,revision,data) values('event',${race.id},1,${sql.json(race)})`;
});
afterAll(closeDatabase);
const input = (expectedRevision = 0) => ({
  raceId: courseRaceId,
  expectedRevision,
  idempotencyKey: randomUUID(),
});
const file = (options: Parameters<typeof syntheticGpx>[0] = {}) => ({
  name: 'alpine-trail.gpx',
  bytes: Buffer.from(syntheticGpx(options)),
});
const load = () => analysis({ raceId: courseRaceId });

it('stores the original file and one active course without editing the Training race', async () => {
  expect((await load()).course).toBeNull();
  const result = await upload(file(), { ...input(), purpose: 'course' });
  const value = await load();
  expect(raceAnalysisSchema.parse(value)).toEqual(value);
  expect(value.revision).toBe(1);
  expect(value.course?.id).toBe(result.assetId);
  const [stored] =
    await connection()`select source from race_analysis.assets where id=${result.assetId!}`;
  expect(Buffer.from(stored!.source)).toEqual(file().bytes);
  const [event] = await connection()`select data from training.records where id=${courseRaceId}`;
  expect(event!.data).toEqual(courseRace());
});
it('retains the previous course and reference evidence when a replacement fails', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  await upload(file({ seconds: 23000 }), {
    ...input(1),
    purpose: 'reference',
    title: 'Synthetic reference',
    terrain: 3,
    durationSeconds: null,
  });
  const before = await load();
  await expect(
    upload(
      { name: 'broken.gpx', bytes: Buffer.from('<gpx>bad') },
      { ...input(2), purpose: 'course' },
    ),
  ).rejects.toThrow();
  expect(await load()).toEqual(before);
  await expect(upload(file({ km: 43 }), { ...input(1), purpose: 'course' })).rejects.toThrow(
    /changed/,
  );
  expect(await load()).toEqual(before);
});
it('rolls back a replacement that fails after inserting its new asset', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  await upload(file({ seconds: 23000 }), {
    ...input(1),
    purpose: 'reference',
    title: 'Synthetic reference',
    terrain: 3,
    durationSeconds: null,
  });
  const before = await load();
  const sql = connection();
  const assets = await sql`select id from race_analysis.assets order by id`;
  const receipts = await sql`select * from host.idempotency order by key`;
  await sql`create function race_analysis.reject_test_update() returns trigger language plpgsql as $$ begin raise exception 'synthetic write failure'; end $$`;
  await sql`create trigger reject_test_update before update on race_analysis.courses for each row execute function race_analysis.reject_test_update()`;
  try {
    await expect(upload(file({ km: 43 }), { ...input(2), purpose: 'course' })).rejects.toThrow(
      /synthetic write failure/,
    );
    expect(await load()).toEqual(before);
    expect(await sql`select id from race_analysis.assets order by id`).toEqual(assets);
    expect(await sql`select * from host.idempotency order by key`).toEqual(receipts);
  } finally {
    await sql`drop trigger reject_test_update on race_analysis.courses`;
    await sql`drop function race_analysis.reject_test_update()`;
  }
});
it('preserves the complete analysis and assets when the reference limit rejects an upload', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  await upload(file({ seconds: 23000 }), {
    ...input(1),
    purpose: 'reference',
    title: 'Synthetic reference',
    terrain: 3,
    durationSeconds: null,
  });
  const sql = connection();
  await sql`insert into race_analysis.reference_efforts(id,race_id,asset_id,title,duration_seconds,duration_source,terrain)
    select gen_random_uuid(),r.race_id,r.asset_id,'Synthetic limit fixture ' || n,r.duration_seconds,r.duration_source,r.terrain
    from race_analysis.reference_efforts r cross join generate_series(1,19) as n`;
  const before = await load();
  const assets = await sql`select id from race_analysis.assets order by id`;
  await expect(
    upload(file({ seconds: 24000 }), {
      ...input(2),
      purpose: 'reference',
      title: 'One too many',
      terrain: 3,
      durationSeconds: null,
    }),
  ).rejects.toThrow(expect.objectContaining({ code: 'reference_limit' }));
  expect(await load()).toEqual(before);
  expect(await sql`select id from race_analysis.assets order by id`).toEqual(assets);
});
it('rejects implausibly fast imported or entered times without changing saved evidence', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  const before = await load();
  const reference = {
    purpose: 'reference' as const,
    title: 'Synthetic reference',
    terrain: 3,
    durationSeconds: null,
  };
  for (const durationSeconds of [null, 312]) {
    await expect(
      upload(file({ km: 36, seconds: 312 }), { ...input(1), ...reference, durationSeconds }),
    ).rejects.toThrow(/time in minutes/);
    expect(await load()).toEqual(before);
  }
  await upload(file({ km: 36, seconds: 18720 }), { ...input(1), ...reference });
  const saved = await load();
  await expect(
    updateReference({
      ...input(2),
      id: saved.references[0]!.id,
      title: 'Typo',
      terrain: 3,
      durationSeconds: 312,
    }),
  ).rejects.toThrow(/time in minutes/);
  expect(await load()).toEqual(saved);
});
it('retries an upload idempotently and refuses stale or conflicting writes', async () => {
  const request = { ...input(), purpose: 'course' as const };
  const first = await upload(file(), request);
  expect(await upload(file(), request)).toEqual(first);
  expect(
    (await connection()`select count(*)::int as count from race_analysis.assets`)[0]!.count,
  ).toBe(1);
  await expect(upload(file({ km: 43 }), request)).rejects.toThrow(/different content/);
  await expect(upload(file({ km: 43 }), { ...input(), purpose: 'course' })).rejects.toThrow(
    /changed/,
  );
  expect((await load()).revision).toBe(1);
});
it('replaces atomically, resets course-specific overrides and keeps references and originals', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  await settings({ ...input(1), terrain: 4, sectionTerrain: { '0': 5 } });
  await upload(file({ km: 32, seconds: 15000 }), {
    ...input(2),
    purpose: 'reference',
    title: 'Past trail',
    durationSeconds: null,
    terrain: 3,
  });
  const before = await load();
  await upload(file({ km: 44 }), { ...input(3), purpose: 'course' });
  const after = await load();
  expect(after.revision).toBe(4);
  expect(after.terrain).toBe(4);
  expect(after.sectionTerrain).toEqual({});
  expect(after.course?.id).not.toBe(before.course?.id);
  expect(after.references).toEqual(before.references);
  expect(
    (await connection()`select count(*)::int as count from race_analysis.assets`)[0]!.count,
  ).toBe(3);
});
it('creates personal estimates, independent comparisons and editable missing-time references', async () => {
  await upload(file(), { ...input(), purpose: 'course' });
  let revision = 1;
  for (const ref of courseReferences) {
    await upload(file(ref), {
      ...input(revision++),
      purpose: 'reference',
      title: ref.title,
      durationSeconds: null,
      terrain: 3,
    });
  }
  const value = await load();
  expect(value.estimate?.referenceCount).toBe(4);
  expect(
    value.references.every((ref) => ref.predictedSeconds !== null && ref.comparison === 'held-out'),
  ).toBe(true);
  const ref = value.references[0]!;
  await updateReference({
    ...input(revision++),
    id: ref.id,
    title: ref.title,
    durationSeconds: null,
    terrain: 4,
  });
  expect((await load()).estimate?.referenceCount).toBe(3);
  await updateReference({
    ...input(revision++),
    id: ref.id,
    title: ref.title,
    durationSeconds: ref.durationSeconds,
    terrain: 4,
  });
  expect((await load()).references.find((r) => r.id === ref.id)?.durationSource).toBe('owner');
  await removeReference({ ...input(revision), id: ref.id });
  expect((await load()).references).toHaveLength(3);
});
it('does not double-count duplicate files or accept section overrides outside the active course', async () => {
  const reference = {
    purpose: 'reference' as const,
    title: 'Reference',
    durationSeconds: 16000,
    terrain: 3,
  };
  await upload(file(), { ...input(), ...reference });
  await expect(upload(file(), { ...input(1), ...reference })).rejects.toThrow(/already included/);
  await upload(file(), { ...input(1), purpose: 'course' });
  await expect(settings({ ...input(2), terrain: 3, sectionTerrain: { '99': 2 } })).rejects.toThrow(
    /sections changed/,
  );
  expect((await load()).revision).toBe(2);
});
it('requires an existing race and owner context; deleting the race does not leak retained courses', async () => {
  await expect(
    plugin.operations.analysis({ raceId: courseRaceId }, { actor: 'agent' }),
  ).rejects.toThrow(/owner/);
  await expect(
    plugin.uploads.track.handle(file(), { ...input(), purpose: 'course' }, { actor: 'agent' }),
  ).rejects.toThrow(/owner/);
  await upload(file(), { ...input(), purpose: 'course' });
  await connection()`update training.records set deleted=true where id=${courseRaceId}`;
  await expect(load()).rejects.toThrow(/no longer available/);
  await expect(upload(file(), { ...input(1), purpose: 'course' })).rejects.toThrow(
    /no longer available/,
  );
  expect(
    (await connection()`select count(*)::int as count from race_analysis.assets`)[0]!.count,
  ).toBe(1);
});
it('refuses writes during maintenance without changing the active course', async () => {
  await connection()`insert into host.settings(key,value) values('maintenance','true') on conflict(key) do update set value='true'`;
  try {
    await expect(upload(file(), { ...input(), purpose: 'course' })).rejects.toThrow(/maintenance/);
  } finally {
    await connection()`update host.settings set value='false' where key='maintenance'`;
  }
  expect((await load()).revision).toBe(0);
});
