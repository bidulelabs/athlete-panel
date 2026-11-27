import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activitySchema, type CommandInput } from '@athlete-panel/contracts';
import { POST } from '../../apps/web/app/api/apple-health/workouts/route';
import { loadWorkspace } from '../../instance/services';
import {
  closeDatabase,
  connection,
  isIsolatedTestInstance,
  transaction,
} from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { recordsRepository } from '../../plugins/activity-records/repository';
import records from '../../plugins/activity-records/server';
import apple from '../../plugins/apple-health/server';
import { normalizeWorkout } from '../../plugins/apple-health/normalize';
import { disconnect, issueToken, status } from '../../plugins/apple-health/repository';
import { mutate } from '../../plugins/training/service';
import { weeklySummary } from '../../plugins/training/summary';
import { historyFields } from '../../plugins/training/history-summary';
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
    await sql`truncate apple_health.connection, apple_health.sources, apple_health.workouts,apple_health.deleted_samples,
      activity_records.routes,activity_records.records,training.records,athlete.records,
      host.idempotency,host.changes`;
    await sql`insert into apple_health.connection default values`;
    await sql`delete from host.settings where key='maintenance'`;
  });
  afterAll(async () => {
    await closeDatabase();
    vi.unstubAllEnvs();
  });

  it('offers a phone-reachable HTTPS pairing URL and permits loopback only in an isolated browser test', async () => {
    const originalFlag = process.env.ATHLETE_PANEL_E2E;
    try {
      vi.stubEnv('ATHLETE_PANEL_E2E', 'false');
      for (const appOrigin of [
        'http://127.0.0.1:3000',
        'https://localhost',
        'https://127.0.0.8',
        'https://[::1]',
        'http://athlete.example',
      ]) {
        vi.stubEnv('APP_ORIGIN', appOrigin);
        expect((await status()).uploadUrl).toBeNull();
        await expect(issueToken()).rejects.toMatchObject({ code: 'upload_url_unavailable' });
      }
      vi.stubEnv('APP_ORIGIN', origin);
      expect((await issueToken()).status.uploadUrl).toBe(origin + '/api/apple-health/workouts');
      vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
      vi.stubEnv('ATHLETE_PANEL_E2E', 'true');
      expect((await issueToken()).status.uploadUrl).toBe(
        'http://127.0.0.1:3000/api/apple-health/workouts',
      );
      vi.stubEnv('DATABASE_URL', databaseUrl.replace(/_test$/, '_owner'));
      expect(isIsolatedTestInstance()).toBe(false);
    } finally {
      vi.stubEnv('APP_ORIGIN', origin);
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('ATHLETE_PANEL_E2E', originalFlag);
    }
  });

  it('upgrades already imported sports while preserving their identity and unknown workout types', async () => {
    const types = ['swim_bike_run', 'pilates', 'elliptical', 'activity_444'];
    const records = types.map((attivita, i) => {
      const facts = normalizeWorkout(appleWorkout(i + 1, { attivita }), 'UTC')!.facts;
      return { ...facts, id: appleUuid(i + 50), revision: 1 };
    });
    await transaction(async (tx) => {
      for (const record of records) {
        const type = record.appleHealth.workoutType;
        await recordsRepository.save(
          'activity',
          {
            ...record,
            sport: type,
            sportSubgroup: null,
            sportResolution: 'unresolved',
            title: type === 'swim_bike_run' ? 'Swim bike run' : record.title,
          },
          tx,
        );
      }
      await tx.unsafe(
        await readFile('plugins/activity-records/migrations/005-apple-workout-sports.sql', 'utf8'),
      );
    });
    const after = (await loadWorkspace()).activities;
    expect(after).toHaveLength(4);
    for (const record of records)
      expect(after.find((item) => item.id === record.id)).toMatchObject({
        ...record,
        revision: record.sportResolution === 'resolved' ? 2 : 1,
      });
  });

  it('remembers early deletions across retries without reporting an unrelated sample as a workout', async () => {
    const { token } = await issueToken();
    await upload(token, { eliminati: [appleUuid(1), appleUuid(1)] });
    await upload(token, { eliminati: [appleUuid(1)] });
    expect(await status()).toMatchObject({ lastUploadAt: null, lastBatch: null, sources: [] });
    expect(await connection()`select uuid from apple_health.workouts`).toHaveLength(0);
    expect(await connection()`select uuid_hash from apple_health.deleted_samples`).toEqual([
      { uuid_hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    for (const inviato of ['2026-11-26T10:00:00Z', '2026-11-28T10:00:00Z'])
      await upload(token, { inviato, allenamenti: [appleWorkout(1)] });
    expect((await loadWorkspace()).activities).toHaveLength(0);
    expect(await status()).toMatchObject({ lastUploadAt: null, sources: [] });
    await upload(token, { allenamenti: [appleWorkout(2, { fonte: 'Copied watch' })] });
    await source('Copied watch', true);
    const excluded = appleWorkout(3, { fonte: 'Copied watch' });
    await upload(token, { allenamenti: [excluded] });
    const received = (await status()).lastUploadAt;
    await upload(token, { eliminati: [appleUuid(3)] });
    expect((await status()).lastUploadAt).toBe(received);
    await source('Copied watch', false);
    await upload(token, { allenamenti: [excluded] });
    expect((await loadWorkspace()).activities).toHaveLength(0);
  });

  it('keeps identified route and validation issues until a correction, deletion or exclusion', async () => {
    const { token } = await issueToken();
    await upload(token, { allenamenti: [appleWorkout(1, { fine: 'invalid' }), { bad: true }] });
    expect(await status()).toMatchObject({
      lastUploadAt: null,
      lastBatch: { issueCount: 2 },
      unresolvedIssues: { count: 1 },
    });
    await upload(token, { allenamenti: [appleWorkout(1, { percorso: [{ lat: 1000 }] })] });
    await upload(token, { allenamenti: [appleWorkout(1), appleWorkout(2)] });
    const before = await status();
    expect(before).toMatchObject({
      lastBatch: { issueCount: 0 },
      unresolvedIssues: { count: 1, messages: [expect.stringContaining('GPS route')] },
    });
    await upload(token, { eliminati: [appleUuid(99)] });
    expect(await status()).toEqual(before);
    await upload(token, { allenamenti: [appleWorkout(3), appleWorkout(3, { fine: 'invalid' })] });
    expect((await loadWorkspace()).activities).toHaveLength(3);
    expect((await status()).lastBatch).toMatchObject({ imported: 1, issueCount: 1 });
    await upload(token, { allenamenti: [appleWorkout(1, { percorso: appleRoutePoints })] });
    expect((await status()).unresolvedIssues.count).toBe(0);
    await upload(token, {
      allenamenti: [appleWorkout(1, { percorso: [] }), appleWorkout(2, { percorso: [] })],
    });
    await upload(token, { eliminati: [appleUuid(2)] });
    expect((await status()).unresolvedIssues.count).toBe(1);
    await source('Synthetic Apple Watch', true);
    expect((await status()).unresolvedIssues.count).toBe(0);
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
    expect(
      weeklySummary(after, appleWorkoutDate)
        .recordedSessions.map((session) => session.source)
        .sort(),
    ).toEqual(['apple-health', 'apple-health', 'garmin']);
    expect(await status()).toMatchObject({ lastBatch: { excluded: 1, imported: 0 } });
    await source('Garmin Connect', false);
    await upload(token, { allenamenti: [copy] });
    expect((await loadWorkspace()).activities).toContainEqual(
      expect.objectContaining({ id: copyId }),
    );
  });

  it.each(['deleted', 'excluded'])(
    'retains linked annotations in Recent changes when a workout is %s',
    async (reason) => {
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
          status: 'partial',
          reason: 'Stopped early',
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
      const conflict = {
        inviato: '2026-11-28T10:00:00Z',
        allenamenti: [appleWorkout(1, { attivita: 'cycling' })],
      };
      await upload(token, conflict);
      await upload(token, { allenamenti: [appleWorkout(1), appleWorkout(2)] });
      expect(await status()).toMatchObject({
        lastBatch: { issueCount: 0 },
        unresolvedIssues: { count: 1, messages: [expect.stringContaining('Planned run')] },
      });
      expect(
        (await loadWorkspace()).activities.find((activity) => activity.id === firstActivity.id)
          ?.sport,
      ).toBe('running');
      if (reason === 'deleted') await upload(token, { eliminati: [appleUuid(1)] });
      else await source('Synthetic Apple Watch', true);
      await upload(token, { allenamenti: [appleWorkout(1)] });
      const after = await loadWorkspace();
      expect(after.workouts[0]?.completion).toBeNull();
      expect(weeklySummary(after, appleWorkoutDate).actual.sessions).toBe(
        reason === 'deleted' ? 1 : 0,
      );
      expect((await status()).unresolvedIssues.count).toBe(0);
      await expect(
        records.operations['download-gpx']!({ id: firstActivity.id }, owner),
      ).rejects.toMatchObject({ status: 404 });
      const history = await connection()`select changes from host.changes where actor='system'`;
      expect(history[0]?.changes[0].before.completion).toMatchObject({
        rpe: 6,
        notes: 'Synthetic effort notes',
      });
      expect(historyFields(history[0]!.changes[0], 'metric', [])).toEqual(
        expect.arrayContaining([
          { label: 'Completion', before: 'Partial', after: 'Planned' },
          { label: 'Completion notes', before: 'Synthetic effort notes', after: 'Not set' },
          { label: 'Completion reason', before: 'Stopped early', after: 'Not set' },
          { label: 'Perceived effort', before: '6 / 10', after: 'Not set' },
        ]),
      );
    },
  );

  it('accepts a previously rejected correction after unlinking and resending the same batch', async () => {
    const { token } = await issueToken();
    const id = appleUuid(80);
    await save({
      action: 'workout.create',
      values: {
        id,
        title: 'Planned run',
        sport: 'running',
        schedule: { kind: 'independent', date: appleWorkoutDate },
      },
    });
    await upload(token, { allenamenti: [appleWorkout(1)] });
    const activityId = (await loadWorkspace()).activities[0]!.id;
    await save({ action: 'workout.link', id, expectedRevision: 1, activityId });
    const correction = {
      inviato: '2026-11-28T10:00:00Z',
      allenamenti: [appleWorkout(1, { attivita: 'elliptical' })],
    };
    await upload(token, correction);
    expect((await status()).unresolvedIssues.count).toBe(1);
    await save({ action: 'workout.unlink', id, expectedRevision: 2 });
    await upload(token, correction);
    expect((await status()).unresolvedIssues.count).toBe(0);
    expect((await loadWorkspace()).activities[0]).toMatchObject({
      id: activityId,
      sport: 'fitness_equipment',
      sportSubgroup: 'elliptical',
    });
  });
});
