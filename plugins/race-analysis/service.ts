import { createHash, randomUUID } from 'node:crypto';
import {
  raceAnalysisSchema,
  raceSelectionSchema,
  raceSettingsInputSchema,
  raceReferenceUpdateSchema,
  raceReferenceRemoveSchema,
  raceUploadInputSchema,
  raceMutationResultSchema,
  type RaceUploadInput,
} from '@athlete-panel/contracts';
import { connection, transaction, type Transaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import { idempotent } from '../../packages/host/src/idempotency';
import type { UploadedFile } from '../../packages/plugin-sdk/src';
import { findRaceEvent } from '../training/public/server';
import { parseTrack } from './parse';
import { analyzeTrack } from './geometry';
import { estimateCourse, referenceTimeProblem } from './estimate';
import { readCourse, readAsset, readReferences } from './repository';

async function requireRace(raceId: string, tx: Transaction) {
  const race = await findRaceEvent(raceId, tx);
  assert(
    race,
    'race_missing',
    'This race is no longer available. Select an existing race from your calendar.',
    404,
  );
  return race;
}
async function currentForWrite(raceId: string, expectedRevision: number, tx: Transaction) {
  await requireRace(raceId, tx);
  const current = await readCourse(raceId, tx);
  assert(
    current.revision === expectedRevision,
    'STALE_REVISION',
    'The course or references changed. Reload saved data and review your draft before saving.',
    409,
  );
  return current;
}
export async function analysis(body: unknown) {
  const { raceId } = raceSelectionSchema.parse(body);
  return connection().begin('isolation level repeatable read read only', async (tx) => {
    const race = await requireRace(raceId, tx),
      current = await readCourse(raceId, tx);
    const course = current.assetId ? await readAsset(current.assetId, tx) : null;
    const references = await readReferences(raceId, tx);
    return raceAnalysisSchema.parse({
      race,
      revision: current.revision,
      course,
      terrain: current.terrain,
      sectionTerrain: current.sectionTerrain,
      ...estimateCourse(
        course?.analysis ?? null,
        current.terrain,
        current.sectionTerrain,
        references,
      ),
    });
  });
}
export async function upload(file: UploadedFile, body: unknown) {
  const input = raceUploadInputSchema.parse(body);
  const parsed = parseTrack(file, input.purpose),
    track = analyzeTrack(parsed);
  if (input.purpose === 'reference') {
    const problem = referenceTimeProblem(
      track.distanceMeters,
      input.durationSeconds ?? track.elapsedSeconds,
    );
    assert(!problem, 'invalid_reference_time', problem ?? 'Check the elapsed time.');
  }
  const fingerprint = createHash('sha256').update(file.bytes).digest('hex');
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'race-analysis.upload', ...input, filename: file.name, fingerprint },
      async () => {
        const current = await currentForWrite(input.raceId, input.expectedRevision, tx);
        if (input.purpose === 'reference') {
          const [count] =
            await tx`select count(*)::int as count from race_analysis.reference_efforts where race_id=${input.raceId}`;
          assert(
            Number(count?.count ?? 0) < 20,
            'reference_limit',
            'Keep at most 20 reference efforts per race. Remove an unused reference first.',
          );
          const duplicate =
            await tx`select a.id from race_analysis.assets a join race_analysis.reference_efforts r on r.asset_id=a.id where r.race_id=${input.raceId} and a.sha256=${fingerprint}`;
          assert(
            !duplicate.length,
            'duplicate_reference',
            'This reference file is already included. Edit its elapsed time or terrain instead.',
          );
        }
        const [usage] =
          await tx`select coalesce(sum(octet_length(source)),0) as bytes from race_analysis.assets`;
        assert(
          Number(usage?.bytes ?? 0) + file.bytes.byteLength <= 512 * 1024 * 1024,
          'storage_limit',
          'Race-file storage has reached 512 MiB. Ask the instance operator to review retained files before importing more.',
        );
        const assetId = randomUUID(),
          revision = current.revision + 1;
        await tx`insert into race_analysis.assets(id,race_id,filename,format,source,sha256,analysis) values(${assetId},${input.raceId},${file.name},${parsed.format},${Buffer.from(file.bytes)},${fingerprint},${tx.json(track)})`;
        await tx`insert into race_analysis.courses(race_id,revision,asset_id,terrain,section_terrain)
      values(${input.raceId},${revision},${input.purpose === 'course' ? assetId : current.assetId},${current.terrain},${tx.json(input.purpose === 'course' ? {} : current.sectionTerrain)})
      on conflict(race_id) do update set revision=excluded.revision,asset_id=excluded.asset_id,section_terrain=excluded.section_terrain,updated_at=now()`;
        if (input.purpose === 'reference')
          await addReference(input, assetId, track.elapsedSeconds, tx);
        return raceMutationResultSchema.parse({ revision, assetId });
      },
    ),
  );
}
async function addReference(
  input: Extract<RaceUploadInput, { purpose: 'reference' }>,
  assetId: string,
  fileSeconds: number | null,
  tx: Transaction,
) {
  const seconds = input.durationSeconds ?? fileSeconds;
  const source =
    input.durationSeconds !== null ? 'owner' : fileSeconds !== null ? 'file' : 'missing';
  await tx`insert into race_analysis.reference_efforts(id,race_id,asset_id,title,duration_seconds,duration_source,terrain)
    values(${randomUUID()},${input.raceId},${assetId},${input.title},${seconds},${source},${input.terrain})`;
}
export async function settings(body: unknown) {
  const input = raceSettingsInputSchema.parse(body);
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'race-analysis.settings', ...input },
      async () => {
        const current = await currentForWrite(input.raceId, input.expectedRevision, tx);
        assert(current.assetId, 'course_missing', 'Upload a course before setting its terrain.');
        const asset = await readAsset(current.assetId, tx);
        const valid = new Set(asset?.analysis.sections.map((s) => String(s.index)));
        assert(
          Object.keys(input.sectionTerrain).every((key) => valid.has(key)),
          'invalid_sections',
          'The sections changed. Reload the course before saving.',
        );
        const revision = current.revision + 1;
        await tx`update race_analysis.courses set terrain=${input.terrain},section_terrain=${tx.json(input.sectionTerrain)},revision=${revision},updated_at=now() where race_id=${input.raceId}`;
        return { revision };
      },
    ),
  );
}
export async function updateReference(body: unknown) {
  const input = raceReferenceUpdateSchema.parse(body);
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'race-analysis.reference-update', ...input },
      async () => {
        const current = await currentForWrite(input.raceId, input.expectedRevision, tx);
        const reference = (await readReferences(input.raceId, tx)).find(
          (ref) => ref.id === input.id,
        );
        assert(reference, 'reference_missing', 'This reference is no longer available.', 404);
        const problem = referenceTimeProblem(reference.distanceMeters, input.durationSeconds);
        assert(!problem, 'invalid_reference_time', problem ?? 'Check the elapsed time.');
        const rows =
          await tx`update race_analysis.reference_efforts set title=${input.title},duration_seconds=${input.durationSeconds},duration_source=${input.durationSeconds === null ? 'missing' : 'owner'},terrain=${input.terrain} where id=${input.id} and race_id=${input.raceId} returning id`;
        assert(rows.length, 'reference_missing', 'This reference is no longer available.', 404);
        const revision = current.revision + 1;
        await tx`update race_analysis.courses set revision=${revision},updated_at=now() where race_id=${input.raceId}`;
        return { revision };
      },
    ),
  );
}
export async function removeReference(body: unknown) {
  const input = raceReferenceRemoveSchema.parse(body);
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'race-analysis.reference-remove', ...input },
      async () => {
        const current = await currentForWrite(input.raceId, input.expectedRevision, tx);
        const rows =
          await tx`delete from race_analysis.reference_efforts where id=${input.id} and race_id=${input.raceId} returning id`;
        assert(rows.length, 'reference_missing', 'This reference is no longer available.', 404);
        const revision = current.revision + 1;
        await tx`update race_analysis.courses set revision=${revision},updated_at=now() where race_id=${input.raceId}`;
        return { revision };
      },
    ),
  );
}
