import { isolatedDatabaseUrl } from '../support/test-database';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { digest } from '../../packages/host/src/crypto';
import { bootstrapOwner, login, logout, requireSession } from '../../packages/host/src/auth';
import { loadWorkspace } from '../../instance/services';
import { recordsRepository } from '../../plugins/activity-records/repository';
import { mutate, undoChange } from '../../plugins/training/service';
import {
  applyProposal,
  contextForToken,
  createGrant,
  revokeGrant,
  submitProposal,
} from '../../plugins/agent-bridge/service';

const suppliedUrl = isolatedDatabaseUrl();
const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const save = (commands: CommandInput[], idempotencyKey = randomUUID()) =>
  mutate({ commands, idempotencyKey });
const workout = (overrides: Record<string, unknown> = {}) => ({
  id: id(2),
  title: 'Ride',
  sport: 'cycling',
  schedule: { kind: 'independent', date: '2026-10-24' },
  durationSeconds: 3600,
  distanceMeters: 30000,
  ...overrides,
});

describe('transactional training and external-agent workflow', () => {
  beforeAll(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = suppliedUrl!;
    await migrate();
  });
  beforeEach(async () => {
    const sql = connection();
    await sql`truncate host.proposals, host.grants, host.changes, host.idempotency, host.sessions, host.owner, host.login_attempts, athlete.records, training.records, activity_records.records`;
    await sql`delete from host.settings where key='maintenance'`;
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('stores hashed owner credentials and sessions, and revokes a logged-out session', async () => {
    const password = 'synthetic-owner-password';
    await bootstrapOwner(password);
    await expect(bootstrapOwner('synthetic-second-owner')).rejects.toMatchObject({
      code: 'owner_exists',
    });
    await expect(login('incorrect-password')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    const token = await login(password);
    await expect(requireSession(token)).resolves.toBeUndefined();
    expect(JSON.stringify(await connection()`select * from host.owner`)).not.toContain(password);
    expect(JSON.stringify(await connection()`select * from host.sessions`)).not.toContain(token);
    await logout(token);
    await expect(requireSession(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('console recovery invalidates every owner session and agent grant', async () => {
    await bootstrapOwner('synthetic-original-password');
    const session = await login('synthetic-original-password');
    const grant = await createGrant({
      label: 'Before recovery',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    await expect(requireSession(grant.token)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(contextForToken(session)).rejects.toMatchObject({ code: 'invalid_grant' });
    await bootstrapOwner('synthetic-recovered-password', true);
    await expect(requireSession(session)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(contextForToken(grant.token)).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(login('synthetic-original-password')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(
      requireSession(await login('synthetic-recovered-password')),
    ).resolves.toBeUndefined();
  });

  it('limits an attacking client without locking out other clients and allows recovery', async () => {
    await bootstrapOwner('synthetic-original-password');
    await connection()`insert into host.login_attempts(key,count,reset_at) values (${`client:${digest('attacker')}`},20,now()+interval '15 minutes')`;
    await expect(login('synthetic-original-password', 'attacker')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    await expect(
      requireSession(await login('synthetic-original-password', 'owner-device')),
    ).resolves.toBeUndefined();
    await bootstrapOwner('synthetic-recovered-password', true);
    await expect(
      requireSession(await login('synthetic-recovered-password')),
    ).resolves.toBeUndefined();
  });

  it('persists private manual training across a fresh DB connection without Garmin or AI', async () => {
    await save([
      {
        action: 'profile.set',
        expectedRevision: null,
        values: { displayName: 'Synthetic athlete', timezone: 'Europe/Paris' },
      },
      { action: 'workout.create', values: workout() as never },
      {
        action: 'workout.complete',
        id: id(2),
        expectedRevision: 1,
        values: { status: 'completed', performedDate: '2026-10-24', durationSeconds: 4000 },
      },
    ]);
    await closeDatabase();
    const state = await loadWorkspace();
    expect(state.profile?.displayName).toBe('Synthetic athlete');
    expect(state.workouts[0].completion).toMatchObject({ source: 'manual', durationSeconds: 4000 });
    expect(state.activities).toEqual([]);
  });

  it('rolls back the entire failed batch including audit and idempotency records', async () => {
    await expect(
      save([
        { action: 'workout.create', values: workout() as never },
        { action: 'workout.update', id: id(99), expectedRevision: 1, values: { title: 'Missing' } },
      ]),
    ).rejects.toThrow();
    expect((await loadWorkspace()).workouts).toEqual([]);
    expect(await connection()`select id from host.changes`).toHaveLength(0);
    expect(await connection()`select key from host.idempotency`).toHaveLength(0);
  });

  it('persists week preferences across connections without moving training dates', async () => {
    await save([
      {
        action: 'profile.set',
        expectedRevision: null,
        values: { weekStartsOnPreference: 'sunday' },
      },
      { action: 'workout.create', values: workout() as never },
    ]);
    await closeDatabase();
    const original = await loadWorkspace();
    expect(original.profile?.weekStartsOnPreference).toBe('sunday');
    await expect(
      save([
        {
          action: 'profile.set',
          expectedRevision: 99,
          values: { weekStartsOnPreference: 'monday' },
        },
      ]),
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect((await loadWorkspace()).profile?.weekStartsOnPreference).toBe('sunday');
    await save([
      { action: 'profile.set', expectedRevision: 1, values: { weekStartsOnPreference: 'monday' } },
    ]);
    await closeDatabase();
    const changed = await loadWorkspace();
    expect(changed.profile?.weekStartsOnPreference).toBe('monday');
    expect(changed.workouts).toEqual(original.workouts);
  });

  it('replays identical requests once and rejects a reused key with different content', async () => {
    const key = randomUUID();
    const command: CommandInput = { action: 'workout.create', values: workout() as never };
    const first = await save([command], key);
    expect(await save([command], key)).toEqual(first);
    expect((await loadWorkspace()).workouts).toHaveLength(1);
    expect(await connection()`select id from host.changes`).toHaveLength(1);
    await expect(
      save(
        [{ action: 'workout.create', values: workout({ id: id(3), title: 'Different' }) as never }],
        key,
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('serializes concurrent edits so one stale request fails without silent overwriting', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const results = await Promise.allSettled([
      save([
        { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'First' } },
      ]),
      save([
        { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'Second' } },
      ]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await loadWorkspace()).workouts[0].revision).toBe(2);
    expect(await connection()`select id from host.changes`).toHaveLength(2);
  });

  it('does not recycle a deleted entity ID into a new revision-1 identity', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    await save([{ action: 'workout.delete', id: id(2), expectedRevision: 1 }]);
    await expect(
      save([
        { action: 'workout.create', values: workout({ title: 'Recycled identity' }) as never },
      ]),
    ).rejects.toThrow();
    expect((await loadWorkspace()).workouts).toHaveLength(0);
  });

  it('expands a plan shift into child changes and atomically undoes every derived date', async () => {
    await save([
      { action: 'plan.create', values: { id: id(1), title: 'Build', startDate: '2026-10-19' } },
      {
        action: 'workout.create',
        values: workout({ schedule: { kind: 'plan', planId: id(1), day: 6 } }) as never,
      },
      {
        action: 'note.create',
        values: {
          id: id(3),
          title: 'Preparation',
          body: 'Easy',
          schedule: { kind: 'plan', planId: id(1), day: 6 },
        },
      },
    ]);
    const shifted = await save([
      {
        action: 'plan.update',
        id: id(1),
        expectedRevision: 1,
        values: { startDate: '2026-10-20' },
      },
    ]);
    expect(
      shifted.changes.filter((change) => change.entity === 'workout' || change.entity === 'note'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: id(2),
          beforeEffectiveDate: '2026-10-24',
          afterEffectiveDate: '2026-10-25',
        }),
        expect.objectContaining({
          id: id(3),
          beforeEffectiveDate: '2026-10-24',
          afterEffectiveDate: '2026-10-25',
        }),
      ]),
    );
    const key = randomUUID();
    const restored = await undoChange({ id: shifted.id, idempotencyKey: key });
    expect(
      restored.changes.filter((change) => change.entity === 'workout' || change.entity === 'note'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: id(2),
          beforeEffectiveDate: '2026-10-25',
          afterEffectiveDate: '2026-10-24',
        }),
        expect.objectContaining({
          id: id(3),
          beforeEffectiveDate: '2026-10-25',
          afterEffectiveDate: '2026-10-24',
        }),
      ]),
    );
    expect(await undoChange({ id: shifted.id, idempotencyKey: key })).toEqual(restored);
    const state = await loadWorkspace();
    expect(state.plans[0].startDate).toBe('2026-10-19');
    expect(state.workouts[0].revision).toBeGreaterThan(2);
    expect(state.notes[0].revision).toBeGreaterThan(2);
  });

  it('blocks whole-batch undo after a later edit even without a revision/timestamp change', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const edit = await save([
      { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'Edited' } },
    ]);
    // Synthetic adversarial fixture: full expected-after comparison must catch this.
    await connection()`update training.records set data=jsonb_set(data,'{title}','"Later same-version edit"'::jsonb) where id=${id(2)}`;
    await expect(undoChange({ id: edit.id, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      code: 'undo_conflict',
    });
    expect((await loadWorkspace()).workouts[0].title).toBe('Later same-version edit');
  });

  async function planWithTwoWorkouts() {
    await save([
      { action: 'plan.create', values: { id: id(1), title: 'Build', startDate: '2026-10-19' } },
      {
        action: 'workout.create',
        values: workout({ schedule: { kind: 'plan', planId: id(1), day: 1 } }) as never,
      },
      {
        action: 'workout.create',
        values: workout({ id: id(3), schedule: { kind: 'plan', planId: id(1), day: 4 } }) as never,
      },
    ]);
    return save([
      { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'Recovery' } },
    ]);
  }

  it('undoes an older workout edit after a later edit of another workout in the same plan', async () => {
    const olderEdit = await planWithTwoWorkouts();
    await save([
      { action: 'workout.update', id: id(3), expectedRevision: 1, values: { title: 'Tempo' } },
    ]);
    await undoChange({ id: olderEdit.id, idempotencyKey: randomUUID() });
    const { workouts } = await loadWorkspace();
    expect(workouts.find((w) => w.id === id(2))?.title).toBe('Ride');
    expect(workouts.find((w) => w.id === id(3))?.title).toBe('Tempo');
  });

  it('refuses to undo a workout edit after its plan start moved', async () => {
    const olderEdit = await planWithTwoWorkouts();
    await save([
      {
        action: 'plan.update',
        id: id(1),
        expectedRevision: 1,
        values: { startDate: '2026-10-20' },
      },
    ]);
    await expect(
      undoChange({ id: olderEdit.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'undo_conflict' });
    expect((await loadWorkspace()).workouts.find((w) => w.id === id(2))?.title).toBe('Recovery');
  });

  it('restores a deleted workout on its day of the moved plan and records that date', async () => {
    await planWithTwoWorkouts();
    const deleted = await save([{ action: 'workout.delete', id: id(3), expectedRevision: 1 }]);
    await save([
      {
        action: 'plan.update',
        id: id(1),
        expectedRevision: 1,
        values: { startDate: '2026-10-20' },
      },
    ]);
    const restored = await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
    expect(restored.changes).toEqual([
      expect.objectContaining({ id: id(3), afterEffectiveDate: '2026-10-23' }),
    ]);
  });

  const inPlanDayTwo = { kind: 'plan', planId: id(1), day: 2 };
  const shiftPlanStart = () =>
    save([
      {
        action: 'plan.update',
        id: id(1),
        expectedRevision: 1,
        values: { startDate: '2026-10-20' },
      },
    ]);
  const laterPlanChanges: Record<string, () => Promise<{ id: string }>> = {
    'its plan start move would shift a later workout': async () => {
      await planWithTwoWorkouts();
      const shifted = await shiftPlanStart();
      await save([
        {
          action: 'workout.create',
          values: workout({ id: id(4), schedule: inPlanDayTwo }) as never,
        },
      ]);
      return shifted;
    },
    'its plan start move would shift a later note': async () => {
      await planWithTwoWorkouts();
      const shifted = await shiftPlanStart();
      await save([
        {
          action: 'note.create',
          values: { id: id(4), title: 'Travel', body: 'Train', schedule: inPlanDayTwo } as never,
        },
      ]);
      return shifted;
    },
    'a workout was added to the plan it created': async () => {
      const created = await save([
        { action: 'plan.create', values: { id: id(1), title: 'Build', startDate: '2026-10-19' } },
      ]);
      await save([
        { action: 'workout.create', values: workout({ schedule: inPlanDayTwo }) as never },
      ]);
      return created;
    },
    'the plan of the workout it deleted was deleted': async () => {
      await planWithTwoWorkouts();
      const deleted = await save([{ action: 'workout.delete', id: id(3), expectedRevision: 1 }]);
      await save([{ action: 'plan.delete', id: id(1), expectedRevision: 1 }]);
      return deleted;
    },
    'a later workout took the position freed by the deletion': async () => {
      const deleted = await deleteFirstOfTwoOnDayTwo();
      await save([
        {
          action: 'workout.create',
          values: workout({ id: id(5), schedule: inPlanDayTwo, order: 2 }) as never,
        },
      ]);
      return deleted;
    },
  };

  async function deleteFirstOfTwoOnDayTwo() {
    await save([
      { action: 'plan.create', values: { id: id(1), title: 'Build', startDate: '2026-10-19' } },
      { action: 'workout.create', values: workout({ schedule: inPlanDayTwo, order: 1 }) as never },
      {
        action: 'workout.create',
        values: workout({ id: id(3), schedule: inPlanDayTwo, order: 2 }) as never,
      },
    ]);
    return save([{ action: 'workout.delete', id: id(2), expectedRevision: 1 }]);
  }

  it('restores a deleted workout to its position when a later workout was added on another day', async () => {
    const deleted = await deleteFirstOfTwoOnDayTwo();
    await save([
      {
        action: 'workout.create',
        values: workout({
          id: id(5),
          schedule: { kind: 'plan', planId: id(1), day: 3 },
          order: 2,
        }) as never,
      },
    ]);
    await undoChange({ id: deleted.id, idempotencyKey: randomUUID() });
    const orders = (await loadWorkspace()).workouts.map((w) => [w.id, w.order]);
    expect(orders).toEqual(
      expect.arrayContaining([
        [id(2), 1],
        [id(3), 2],
        [id(5), 1],
      ]),
    );
  });

  it.each(Object.entries(laterPlanChanges))(
    'refuses to undo a change when %s',
    async (_, change) => {
      const { id: changeId } = await change();
      const before = await loadWorkspace();
      const auditBefore = await connection()`select * from host.changes order by id`;
      await expect(
        undoChange({ id: changeId, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: 'undo_conflict', status: 409 });
      expect(await loadWorkspace()).toEqual(before);
      expect(await connection()`select * from host.changes order by id`).toEqual(auditBefore);
    },
  );

  it('does not restore an obsolete deletion when its tombstone revision has independently advanced', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const deleted = await save([{ action: 'workout.delete', id: id(2), expectedRevision: 1 }]);
    // An independently persisted revision must not compare equal merely because both visible states are absent.
    await connection()`update training.records set revision=revision+2 where id=${id(2)}`;
    await expect(
      undoChange({ id: deleted.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'undo_conflict' });
    expect((await loadWorkspace()).workouts).toHaveLength(0);
  });

  async function unlinkedRide() {
    const activityId = id(9);
    await connection().begin((tx) =>
      recordsRepository.save(
        'activity',
        {
          id: activityId,
          revision: 1,
          provider: 'garmin',
          externalId: 'synthetic-ride',
          title: 'Synthetic ride',
          sport: 'cycling',
          sportSubgroup: 'gravel_cycling',
          startedAt: '2026-10-24T08:00:00.000Z',
          localDate: '2026-10-24',
          dateSource: 'provider',
          durationSeconds: 3600,
          distanceMeters: 30000,
          elevationMeters: null,
          averageHeartRateBpm: null,
        },
        tx,
      ),
    );
    await save([
      {
        action: 'workout.create',
        values: workout({ sportSubgroup: 'gravel_cycling' }) as never,
      },
      {
        action: 'workout.create',
        values: workout({ id: id(3), sportSubgroup: 'gravel_cycling' }) as never,
      },
      {
        action: 'workout.complete',
        id: id(2),
        expectedRevision: 1,
        values: {
          status: 'partial',
          performedDate: '2026-10-24',
          rpe: 6,
          reason: 'Stopped early',
          notes: 'Synthetic completion note\nSecond line',
        },
      },
      { action: 'workout.link', id: id(2), expectedRevision: 1, activityId },
    ]);
    const unlinked = await save([{ action: 'workout.unlink', id: id(2), expectedRevision: 1 }]);
    return { activityId, unlinked };
  }

  it('restores a subgroup activity link and annotations on undo, with identical retries', async () => {
    const { activityId, unlinked } = await unlinkedRide();
    const input = { id: unlinked.id, idempotencyKey: randomUUID() };
    const restored = await undoChange(input);
    const state = await loadWorkspace();
    expect(state.workouts.find((w) => w.id === id(2))).toMatchObject({
      sportSubgroup: 'gravel_cycling',
      revision: 3,
      completion: {
        activityId,
        status: 'partial',
        rpe: 6,
        reason: 'Stopped early',
        notes: 'Synthetic completion note\nSecond line',
        durationSeconds: 3600,
        distanceMeters: 30000,
      },
    });
    expect(await undoChange(input)).toEqual(restored);
    expect(await loadWorkspace()).toEqual(state);
  });

  it('refuses with a conflict to undo an unlink once the activity is linked elsewhere', async () => {
    const { activityId, unlinked } = await unlinkedRide();
    await save([{ action: 'workout.link', id: id(3), expectedRevision: 1, activityId }]);
    const before = await loadWorkspace();
    const auditBefore = await connection()`select * from host.changes order by id`;
    const idempotencyKey = randomUUID();
    await expect(undoChange({ id: unlinked.id, idempotencyKey })).rejects.toMatchObject({
      code: 'ALREADY_LINKED',
      status: 409,
    });
    const state = await loadWorkspace();
    expect(state).toEqual(before);
    expect(await connection()`select * from host.changes order by id`).toEqual(auditBefore);
    expect(
      await connection()`select key from host.idempotency where key=${idempotencyKey}`,
    ).toHaveLength(0);
    expect(state.workouts.find((w) => w.id === id(2))?.completion).toBeNull();
    expect(state.workouts.find((w) => w.id === id(3))?.completion?.activityId).toBe(activityId);
  });

  it('refuses undo when an unlinked activity now has an incompatible Garmin subgroup', async () => {
    const { activityId, unlinked } = await unlinkedRide();
    const activity = (await loadWorkspace()).activities.find((item) => item.id === activityId)!;
    await connection().begin((tx) =>
      recordsRepository.save(
        'activity',
        { ...activity, revision: 2, sportSubgroup: 'mountain_biking' },
        tx,
      ),
    );
    const before = await loadWorkspace();
    const auditBefore = await connection()`select * from host.changes order by id`;
    await expect(
      undoChange({ id: unlinked.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 400 });
    expect(await loadWorkspace()).toEqual(before);
    expect(await connection()`select * from host.changes order by id`).toEqual(auditBefore);
  });

  it('bounds grant context and stores only a token hash', async () => {
    await save([
      { action: 'workout.create', values: workout({ notes: 'Private note' }) as never },
      {
        action: 'workout.create',
        values: workout({
          id: id(3),
          schedule: { kind: 'independent', date: '2026-12-01' },
        }) as never,
      },
      {
        action: 'note.create',
        values: {
          id: id(4),
          title: 'Private',
          body: 'Secret narrative',
          schedule: { kind: 'independent', date: '2026-10-24' },
        },
      },
    ]);
    const grant = await createGrant({
      label: 'Test',
      from: '2026-10-19',
      to: '2026-10-25',
      includeNotes: false,
    });
    const result = await contextForToken(grant.token);
    expect(result.context.workouts).toHaveLength(1);
    expect(result.context.workouts[0].notes).toBe('');
    expect(result.context.notes).toEqual([]);
    const stored = await connection()`select * from host.grants`;
    expect(JSON.stringify(stored)).not.toContain(grant.token);
    expect(stored[0].token_hash).toHaveLength(64);
  });

  it('requires exact in-app proposal approval, applies once, and allows conflict-free undo', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const grant = await createGrant({ label: 'Week edit', from: '2026-10-19', to: '2026-10-25' });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'workout.update',
          id: id(2),
          expectedRevision: 1,
          values: { durationSeconds: 1800 },
        },
      ],
      summary: 'Reduce duration',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(3600);
    await expect(
      applyProposal({ id: proposal.id, digest: '0'.repeat(64), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'digest_mismatch' });
    const key = randomUUID();
    const applied = await applyProposal({
      id: proposal.id,
      digest: proposal.digest,
      idempotencyKey: key,
    });
    expect(
      await applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: key }),
    ).toEqual(applied);
    expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(1800);
    await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
    expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(3600);
  });

  it('excludes nested interval/completion/plan notes and prevents overwriting hidden interval notes', async () => {
    const steps = [
      { kind: 'warmup', durationSeconds: 300, notes: 'PRIVATE_WARMUP' },
      {
        kind: 'repeat',
        times: 2,
        steps: [{ kind: 'work', durationSeconds: 300, notes: 'PRIVATE_REPEAT' }],
      },
    ];
    await save([
      {
        action: 'plan.create',
        values: { id: id(1), title: 'Plan', startDate: '2026-10-19', description: 'PRIVATE_PLAN' },
      },
      {
        action: 'workout.create',
        values: workout({
          exercises: [{ name: 'Squat', repetitions: '8–10', instructions: 'PRIVATE_EXERCISE' }],
          plannedElevationGainMeters: 0,
          steps,
          schedule: { kind: 'plan', planId: id(1), day: 6 },
        }) as never,
      },
      { action: 'workout.create', values: workout({ id: id(3), steps }) as never },
      {
        action: 'workout.complete',
        id: id(3),
        expectedRevision: 1,
        values: {
          status: 'partial',
          performedDate: '2026-10-24',
          reason: 'PRIVATE_COMPLETION',
          notes: 'PRIVATE_COMPLETION_NOTES',
        },
      },
    ]);
    const grant = await createGrant({
      label: 'No narrative notes',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    const context = await contextForToken(grant.token);
    expect(JSON.stringify(context)).not.toContain('PRIVATE_');
    const included = await createGrant({
      label: 'Include notes',
      from: '2026-10-19',
      to: '2026-10-25',
      includeNotes: true,
    });
    for (const value of [
      'PRIVATE_WARMUP',
      'PRIVATE_REPEAT',
      'PRIVATE_COMPLETION',
      'PRIVATE_PLAN',
      'PRIVATE_EXERCISE',
      'PRIVATE_COMPLETION_NOTES',
    ])
      expect(JSON.stringify(await contextForToken(included.token))).toContain(value);
    const proposal = {
      summary: 'Change intervals',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    };
    await expect(
      submitProposal(grant.token, {
        ...proposal,
        commands: [
          {
            action: 'workout.update',
            id: id(2),
            expectedRevision: 1,
            values: { steps: [{ kind: 'work', durationSeconds: 600 }] },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      submitProposal(grant.token, {
        ...proposal,
        commands: [
          {
            action: 'workout.duplicate',
            id: id(2),
            expectedRevision: 1,
            values: { schedule: { kind: 'independent', date: '2026-10-25' } },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      submitProposal(grant.token, {
        ...proposal,
        idempotencyKey: randomUUID(),
        commands: [
          {
            action: 'workout.update',
            id: id(2),
            expectedRevision: 1,
            values: { exercises: [{ name: 'Squat', repetitions: '10' }] },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(context.context.workouts.find((w) => w.id === id(2))).toMatchObject({
      plannedElevationGainMeters: 0,
      exercises: [{ name: 'Squat', repetitions: '8–10', instructions: '' }],
    });
    expect(JSON.stringify(await loadWorkspace())).toContain('PRIVATE_REPEAT');
  });

  it('rejects stale safety context after an injury changes and leaves training intact', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const grant = await createGrant({ label: 'Week', from: '2026-10-19', to: '2026-10-25' });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'workout.update',
          id: id(2),
          expectedRevision: 1,
          values: { durationSeconds: 7200 },
        },
      ],
      summary: 'Longer',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    await save([
      { action: 'injury.create', values: { id: id(5), bodyPart: 'Knee', startDate: '2026-10-24' } },
    ]);
    await expect(
      applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'stale_context' });
    expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(3600);
  });

  it.each([
    { importedDate: '2026-10-24', relevant: true },
    { importedDate: '2020-10-24', relevant: false },
  ])(
    'invalidates only relevant health imports ($importedDate)',
    async ({ importedDate, relevant }) => {
      await save([{ action: 'workout.create', values: workout() as never }]);
      const grant = await createGrant({
        label: 'Health freshness',
        from: '2026-10-19',
        to: '2026-10-25',
      });
      const context = await contextForToken(grant.token);
      const proposal = await submitProposal(grant.token, {
        commands: [
          {
            action: 'workout.update',
            id: id(2),
            expectedRevision: 1,
            values: { durationSeconds: 1800 },
          },
        ],
        summary: 'Adjust duration',
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      });
      const health = {
        id: id(9),
        revision: 1,
        provider: 'garmin',
        externalId: `555:sleep:${importedDate}`,
        metric: 'sleepDurationSeconds',
        localDate: importedDate,
        measuredAt: null,
        value: 28800,
      };
      await connection()`insert into activity_records.records(kind,id,revision,data) values('health',${health.id},1,${connection().json(health)})`;
      const applying = applyProposal({
        id: proposal.id,
        digest: proposal.digest,
        idempotencyKey: randomUUID(),
      });
      if (relevant) {
        await expect(applying).rejects.toMatchObject({ code: 'stale_context' });
        expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(3600);
      } else {
        await applying;
        expect((await loadWorkspace()).workouts[0].durationSeconds).toBe(1800);
      }
    },
  );

  it('keeps the context digest when a health day moves from the daily list into a week', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    for (const [index, localDate] of ['2026-10-17', '2026-10-18'].entries()) {
      const health = {
        id: id(20 + index),
        revision: 1,
        provider: 'garmin',
        externalId: `555:hrv:${localDate}:hrvMilliseconds`,
        metric: 'hrvMilliseconds',
        localDate,
        measuredAt: null,
        value: 40 + index * 10,
      };
      await connection()`insert into activity_records.records(kind,id,revision,data) values('health',${health.id},1,${connection().json(health)})`;
    }
    const grant = await createGrant({ label: 'Two weeks', from: '2026-10-12', to: '2026-10-25' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
      const saturday = await contextForToken(grant.token);
      vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
      const sunday = await contextForToken(grant.token);
      expect(saturday.context.health.map((r) => r.localDate)).toEqual(['2026-10-18']);
      expect(saturday.context.healthWeeks[0]!.metrics.hrvMilliseconds).toEqual({
        average: 40,
        days: 1,
      });
      expect(sunday.context.health).toEqual([]);
      expect(sunday.context.healthWeeks[0]!.metrics.hrvMilliseconds).toEqual({
        average: 45,
        days: 2,
      });
      expect(sunday.contextDigest).toBe(saturday.contextDigest);
      await expect(
        submitProposal(grant.token, {
          commands: [
            {
              action: 'workout.update',
              id: id(2),
              expectedRevision: 1,
              values: { durationSeconds: 1800 },
            },
          ],
          summary: 'Adjust duration',
          contextDigest: saturday.contextDigest,
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not disclose excluded notes in proposal submission responses or erase them on apply', async () => {
    const secret = 'Synthetic private note excluded from the grant';
    await save([{ action: 'workout.create', values: workout({ notes: secret }) as never }]);
    const grant = await createGrant({
      label: 'Prescription only',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'workout.update',
          id: id(2),
          expectedRevision: 1,
          values: { title: 'Adjusted prescription' },
        },
      ],
      summary: 'Rename',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    expect(JSON.stringify(context)).not.toContain(secret);
    expect(JSON.stringify(proposal)).not.toContain(secret);
    await applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() });
    expect((await loadWorkspace()).workouts[0].notes).toBe(secret);
  });

  it('rejects revoked/expired tokens and out-of-scope changes before proposal persistence', async () => {
    await save([{ action: 'workout.create', values: workout() as never }]);
    const grant = await createGrant({ label: 'Week', from: '2026-10-19', to: '2026-10-25' });
    const context = await contextForToken(grant.token);
    await expect(
      submitProposal(grant.token, {
        commands: [
          {
            action: 'workout.update',
            id: id(2),
            expectedRevision: 1,
            values: { schedule: { kind: 'independent', date: '2026-11-01' } },
          },
        ],
        summary: 'Out of bounds',
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'out_of_scope' });
    expect(await connection()`select id from host.proposals`).toHaveLength(0);
    await revokeGrant({ id: grant.grant.id });
    await expect(contextForToken(grant.token)).rejects.toMatchObject({ code: 'invalid_grant' });
    const expired = await createGrant({ label: 'Expired', from: '2026-10-19', to: '2026-10-25' });
    await connection()`update host.grants set expires_at=now()-interval '1 second' where id=${expired.grant.id}`;
    await expect(contextForToken(expired.token)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('permits note-free workout creation with a grant that excludes private notes', async () => {
    const grant = await createGrant({ label: 'New workout', from: '2026-10-19', to: '2026-10-25' });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [{ action: 'workout.create', values: workout() }],
      summary: 'Add a ride',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    await applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() });
    expect((await loadWorkspace()).workouts).toHaveLength(1);
  });

  it('includes an empty scheduled plan so the agent can populate a block the owner has created', async () => {
    await save([
      {
        action: 'plan.create',
        values: { id: id(1), title: 'New training block', startDate: '2026-10-19' },
      },
    ]);
    const grant = await createGrant({
      label: 'Populate block',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    const context = await contextForToken(grant.token);
    expect(context.context.plans.map((plan) => plan.id)).toContain(id(1));
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'workout.create',
          values: workout({ schedule: { kind: 'plan', planId: id(1), day: 2 } }),
        },
      ],
      summary: 'Add the first session',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    await applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() });
    expect((await loadWorkspace()).workouts[0].schedule).toEqual({
      kind: 'plan',
      planId: id(1),
      day: 2,
    });
  });

  it('cannot erase excluded private notes by submitting an empty string', async () => {
    await save([
      { action: 'workout.create', values: workout({ notes: 'Private narrative' }) as never },
    ]);
    const grant = await createGrant({
      label: 'No private notes',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    const context = await contextForToken(grant.token);
    await expect(
      submitProposal(grant.token, {
        commands: [
          { action: 'workout.update', id: id(2), expectedRevision: 1, values: { notes: '' } },
        ],
        summary: 'Clear hidden notes',
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await loadWorkspace()).workouts[0].notes).toBe('Private narrative');
  });

  it('cannot copy an out-of-scope source into the grant as a read-permission bypass', async () => {
    await save([
      {
        action: 'workout.create',
        values: workout({
          title: 'Outside private history',
          schedule: { kind: 'independent', date: '2026-09-01' },
        }) as never,
      },
    ]);
    const grant = await createGrant({
      label: 'October only',
      from: '2026-10-19',
      to: '2026-10-25',
    });
    const context = await contextForToken(grant.token);
    expect(context.context.workouts).toHaveLength(0);
    await expect(
      submitProposal(grant.token, {
        commands: [
          {
            action: 'workout.duplicate',
            id: id(2),
            expectedRevision: 1,
            values: { schedule: { kind: 'independent', date: '2026-10-24' } },
          },
        ],
        summary: 'Copy hidden source',
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'out_of_scope' });
    expect(await connection()`select id from host.proposals`).toHaveLength(0);
  });

  it('permits a pending workout edit in a longer plan without granting all plan dates', async () => {
    await save([
      { action: 'plan.create', values: { id: id(1), title: 'Long plan', startDate: '2026-10-01' } },
      {
        action: 'workout.create',
        values: workout({ schedule: { kind: 'plan', planId: id(1), day: 24 } }) as never,
      },
      {
        action: 'workout.create',
        values: workout({ id: id(3), schedule: { kind: 'plan', planId: id(1), day: 5 } }) as never,
      },
    ]);
    const grant = await createGrant({ label: 'One week', from: '2026-10-19', to: '2026-10-25' });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'workout.update',
          id: id(2),
          expectedRevision: 1,
          values: { durationSeconds: 1800 },
        },
      ],
      summary: 'Reduce next ride',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    await applyProposal({ id: proposal.id, digest: proposal.digest, idempotencyKey: randomUUID() });
    const state = await loadWorkspace();
    expect(state.workouts.find((item) => item.id === id(2))?.durationSeconds).toBe(1800);
    expect(state.workouts.find((item) => item.id === id(3))?.durationSeconds).toBe(3600);
  });

  it('previews and applies plan duplication with identical generated child IDs', async () => {
    await save([
      {
        action: 'plan.create',
        values: { id: id(1), title: 'Short plan', startDate: '2026-10-19' },
      },
      {
        action: 'workout.create',
        values: workout({ schedule: { kind: 'plan', planId: id(1), day: 1 } }) as never,
      },
    ]);
    const grant = await createGrant({
      label: 'Repeat',
      from: '2026-10-19',
      to: '2026-10-25',
      includeNotes: true,
    });
    const context = await contextForToken(grant.token);
    const proposal = await submitProposal(grant.token, {
      commands: [
        {
          action: 'plan.duplicate',
          id: id(1),
          expectedRevision: 1,
          values: { title: 'Repeated', startDate: '2026-10-21' },
        },
      ],
      summary: 'Repeat a short plan',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    });
    const applied = await applyProposal({
      id: proposal.id,
      digest: proposal.digest,
      idempotencyKey: randomUUID(),
    });
    expect(
      applied.changes.filter((change) => change.before === null && change.entity === 'workout'),
    ).toHaveLength(1);
    expect((await loadWorkspace()).plans).toHaveLength(2);
  });
});
