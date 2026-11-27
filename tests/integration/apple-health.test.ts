import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activitySchema, type CommandInput } from '@athlete-panel/contracts';
import { POST } from '../../apps/web/app/api/apple-health/workouts/route';
import { loadWorkspace } from '../../instance/services';
import { closeDatabase, connection, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { recordsRepository } from '../../plugins/activity-records/repository';
import records from '../../plugins/activity-records/server';
import apple from '../../plugins/apple-health/server';
import { disconnect, issueToken, status } from '../../plugins/apple-health/repository';
import { mutate } from '../../plugins/training/service';
import { weeklySummary } from '../../plugins/training/summary';
import {
  appleBatch,
  appleConnectionTest,
  appleRoutePoints,
  appleUuid,
  appleWorkout,
  appleWorkoutDate,
} from '../fixtures/apple-health';
import { isolatedDatabaseUrl } from '../support/test-database';

const databaseUrl = isolatedDatabaseUrl();
const origin = 'https://athlete.example';
const owner = { actor: 'owner' } as const;
const save = (...commands: CommandInput[]) => mutate({ commands, idempotencyKey: randomUUID() });

function request(token: string, body: unknown) {
  return new Request(`${origin}/api/apple-health/workouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function upload(token: string, body: unknown) {
  const response = await POST(request(token, appleBatch(body as Record<string, unknown>)));
  expect(response.status, await response.text()).toBe(204);
}

const source = (name: string, excluded: boolean) =>
  apple.operations['set-source']({ name, excluded });

describe('Apple Health workout imports', () => {
  beforeAll(async () => {
    await closeDatabase();
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('APP_ORIGIN', origin);
    await migrate();
  });
  beforeEach(async () => {
    const sql = connection();
    await sql`truncate apple_health.connection, apple_health.sources, apple_health.workouts,
      activity_records.routes,activity_records.records,training.records,athlete.records,
      host.idempotency,host.changes`;
    await sql`insert into apple_health.connection default values`;
    await sql`delete from host.settings where key='maintenance'`;
  });
  afterAll(async () => {
    await closeDatabase();
    vi.unstubAllEnvs();
  });

  it('tests the connection separately, resumes a failed backfill and revokes old credentials', async () => {
    const { token } = await issueToken();
    expect((await POST(request(token, appleConnectionTest))).status).toBe(204);
    expect(await status()).toMatchObject({
      connected: true,
      testedAt: expect.any(String),
      lastUploadAt: null,
    });
    expect(
      (await POST(request(token, appleBatch({ diagnostica: { righe: ['PRIVATE'] } })))).status,
    ).toBe(204);
    expect((await status()).lastUploadAt).toBeNull();
    await upload(token, { allenamenti: [appleWorkout(1)] });

    await connection()`insert into host.settings(key,value) values('maintenance','true')`;
    const next = appleBatch({ allenamenti: [appleWorkout(2)] });
    expect((await POST(request(token, next))).status).toBe(503);
    await connection()`delete from host.settings where key='maintenance'`;
    expect((await POST(request(token, next))).status).toBe(204);
    await upload(token, { allenamenti: [appleWorkout(1)] });
    expect((await loadWorkspace()).activities).toHaveLength(2);

    const rotated = await issueToken();
    const rejected = request(token, next);
    expect((await POST(rejected)).status).toBe(401);
    expect(rejected.bodyUsed).toBe(false);
    expect((await status()).testedAt).toBeNull();
    expect((await POST(request(rotated.token, { invalid: true }))).status).toBe(400);
    expect((await status()).error).toContain('version 1');
    await disconnect();
    expect((await POST(request(rotated.token, next))).status).toBe(401);
    expect(await status()).toMatchObject({ connected: false, importedFrom: appleWorkoutDate });
    expect((await loadWorkspace()).activities).toHaveLength(2);
  });

  it('shows Apple and Garmin workouts, excludes a copied source and restores stable IDs by replay', async () => {
    const { token } = await issueToken();
    await transaction((tx) =>
      recordsRepository.save(
        'activity',
        activitySchema.parse({
          id: appleUuid(99),
          revision: 1,
          title: 'Garmin ride',
          provider: 'garmin',
          sport: 'cycling',
          externalId: 'synthetic-garmin:99',
          startedAt: `${appleWorkoutDate}T10:30:00Z`,
          localDate: appleWorkoutDate,
          dateSource: 'provider',
          durationSeconds: 3600,
          distanceMeters: 30000,
          averageHeartRateBpm: null,
          elevationMeters: 300,
        }),
        tx,
      ),
    );
    const copy = appleWorkout(3, { attivita: 'cycling', fonte: 'Garmin Connect' });
    await upload(token, {
      allenamenti: [
        appleWorkout(1),
        appleWorkout(2, { metadati: { HKIndoorWorkout: '1' }, distanza_m: null }),
        copy,
        { bad: true },
      ],
    });
    const workspace = await loadWorkspace();
    const copyId = workspace.activities.find(
      (record) => record.externalId === `apple-health:${appleUuid(3)}`,
    )!.id;
    expect(
      workspace.activities.find((record) => record.sportSubgroup === 'indoor_running')
        ?.distanceMeters,
    ).toBeNull();
    expect(await status()).toMatchObject({ lastBatch: { imported: 3, issueCount: 1 } });
    await source('Garmin Connect', true);
    await upload(token, { allenamenti: [copy] });
    const after = await loadWorkspace();
    expect(after.activities).toHaveLength(3);
    expect(weeklySummary(after, appleWorkoutDate).actual).toMatchObject({
      sessions: 3,
      elevationMeters: { cycling: { value: 300 }, running: { value: 140 } },
    });
    expect(await status()).toMatchObject({ lastBatch: { excluded: 1, imported: 0 } });
    await source('Garmin Connect', false);
    await upload(token, { allenamenti: [copy] });
    expect((await loadWorkspace()).activities).toContainEqual(
      expect.objectContaining({ id: copyId }),
    );
  });

  it('links manually, preserves corrections and notes, and retracts a linked deletion atomically', async () => {
    const { token } = await issueToken();
    const planId = appleUuid(90);
    await save({
      action: 'workout.create',
      values: {
        id: planId,
        title: 'Planned run',
        sport: 'running',
        schedule: { kind: 'independent', date: appleWorkoutDate },
        durationSeconds: 2400,
      },
    });
    await upload(token, { allenamenti: [appleWorkout(1)] });
    const firstActivity = (await loadWorkspace()).activities[0]!;
    await upload(token, { allenamenti: [appleWorkout(2)] });
    expect((await loadWorkspace()).workouts[0]?.completion).toBeNull();
    await save({
      action: 'workout.link',
      id: planId,
      expectedRevision: 1,
      activityId: firstActivity.id,
    });
    expect(weeklySummary(await loadWorkspace(), appleWorkoutDate).actual.sessions).toBe(2);
    await save({
      action: 'workout.complete',
      id: planId,
      expectedRevision: 2,
      values: {
        status: 'completed',
        performedDate: appleWorkoutDate,
        notes: 'Synthetic effort notes',
        rpe: 6,
      },
    });
    await upload(token, {
      inviato: '2026-11-27T10:05:00Z',
      allenamenti: [appleWorkout(1, { durata_s: 2800, percorso: appleRoutePoints })],
    });
    expect((await loadWorkspace()).workouts[0]?.completion).toMatchObject({
      source: 'apple-health',
      durationSeconds: 2800,
      activityId: firstActivity.id,
      rpe: 6,
      notes: 'Synthetic effort notes',
    });
    const route = await records.operations['download-gpx']!({ id: firstActivity.id }, owner);
    expect(route.gpx).toContain('<ele>122.000</ele>');
    // A queued copy of an earlier upload cannot overwrite the correction.
    await upload(token, { allenamenti: [appleWorkout(1)] });
    expect((await loadWorkspace()).workouts[0]?.completion?.durationSeconds).toBe(2800);
    await upload(token, { eliminati: [appleUuid(1)] });
    await upload(token, { allenamenti: [appleWorkout(1)] });
    const after = await loadWorkspace();
    expect(after.workouts[0]?.completion).toBeNull();
    expect(weeklySummary(after, appleWorkoutDate).actual.sessions).toBe(1);
    await expect(
      records.operations['download-gpx']!({ id: firstActivity.id }, owner),
    ).rejects.toMatchObject({ status: 404 });
    const history = await connection()`select changes from host.changes where actor='system'`;
    expect(history[0]?.changes[0].before.completion).toMatchObject({
      rpe: 6,
      notes: 'Synthetic effort notes',
    });
  });
});
