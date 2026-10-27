import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type CommandInput } from '@athlete-panel/contracts';
import { closeDatabase, connection } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { digest } from '../../packages/host/src/crypto';
import { bootstrapOwner, login, logout, requireSession } from '../../packages/host/src/auth';
import { loadWorkspace } from '../../instance/services';
import { mutate, undoChange } from '../../plugins/training/service';
import {
  applyProposal,
  contextForToken,
  createGrant,
  revokeGrant,
  submitProposal,
} from '../../plugins/agent-bridge/service';

// Destructive cleanup is allowed only against an explicitly supplied isolated local test DB.
const suppliedUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!suppliedUrl)
  throw new Error(
    'Domain integration tests require an explicitly configured isolated local *_test database.',
  );
if (suppliedUrl) {
  const url = new URL(suppliedUrl);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.slice(1).endsWith('_test')
  ) {
    throw new Error(
      'Domain integration tests require an explicit localhost database whose name ends in _test.',
    );
  }
}
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
        values: workout({ steps, schedule: { kind: 'plan', planId: id(1), day: 6 } }) as never,
      },
      { action: 'workout.create', values: workout({ id: id(3), steps }) as never },
      {
        action: 'workout.complete',
        id: id(3),
        expectedRevision: 1,
        values: { status: 'partial', performedDate: '2026-10-24', reason: 'PRIVATE_COMPLETION' },
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
    for (const value of ['PRIVATE_WARMUP', 'PRIVATE_REPEAT', 'PRIVATE_COMPLETION', 'PRIVATE_PLAN'])
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
