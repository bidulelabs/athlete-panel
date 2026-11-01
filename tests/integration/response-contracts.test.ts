import { isolatedDatabaseUrl } from '../support/test-database';
import { persistAndAudit } from '../../instance/commit';
import { applyCommands } from '../../plugins/training/engine';
import { emptyWorkspace } from '@athlete-panel/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closeDatabase, connection, transaction } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { readWorkspaceResponse } from '../../instance/workspace-response';
import { workspaceEnvelopeSchema } from '@athlete-panel/contracts';
import { trainingRepository } from '../../plugins/training/repository';
import { mutate } from '../../plugins/training/service';
import { requiredRow, optionalRow } from '../../packages/host/src/rows';
import { AppError } from '../../packages/host/src/errors';
import {
  createGrant,
  contextForToken,
  submitProposal,
  proposalDetails,
} from '../../plugins/agent-bridge/service';
import { summarizeProposal } from '../../plugins/agent-bridge/proposal-weeks';
const supplied = isolatedDatabaseUrl();
describe('typed database responses', () => {
  beforeAll(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = supplied;
    await migrate();
  });
  beforeEach(async () => {
    await connection()`truncate host.proposals,host.grants,host.changes,host.idempotency,host.jobs,athlete.records,training.records,activity_records.records,garmin.coverage`;
    await connection()`delete from host.settings where key in ('maintenance','garmin','onboarding','worker','lastBackup','backupAttempt','backupSchedule')`;
  });
  afterAll(closeDatabase);
  it('maps real SQL timestamps and nullable results into the public contract', async () => {
    await mutate({
      commands: [
        {
          action: 'workout.create',
          values: {
            title: 'Synthetic ride',
            sport: 'cycling',
            schedule: { kind: 'independent', date: '2026-10-27' },
          },
        },
      ],
      idempotencyKey: randomUUID(),
    });
    const response = await readWorkspaceResponse({ from: '2026-10-26', to: '2026-11-01' });
    expect(workspaceEnvelopeSchema.parse(response)).toEqual(response);
    expect(response.changes).toHaveLength(1);
    expect(typeof response.changes[0].createdAt).toBe('string');
    expect(response.changes[0].undoneAt).toBeNull();
    expect(response.state.workouts).toHaveLength(1);
  });
  it('rejects invalid stored JSON rather than asserting its type', async () => {
    const id = randomUUID();
    await connection()`insert into training.records(kind,id,revision,data) values('plan',${id},1,'{}'::jsonb)`;
    await expect(trainingRepository.list('plan')).rejects.toThrow();
    await expect(readWorkspaceResponse({ from: '2026-10-26', to: '2026-11-01' })).rejects.toThrow();
  });
  it('lists both ends of workout moves and plan dates without returning full proposal diffs', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const workoutId = randomUUID(),
      planId = randomUUID();
    await mutate({
      idempotencyKey: randomUUID(),
      commands: [
        {
          action: 'workout.create',
          values: {
            id: workoutId,
            title: 'Synthetic move',
            sport: 'running',
            schedule: { kind: 'independent', date: '2024-06-15' },
          },
        },
        {
          action: 'plan.create',
          values: { id: planId, title: 'Synthetic plan', startDate: '2024-06-01' },
        },
      ],
    });
    const { token } = await createGrant({
      label: 'Date bounds',
      version: 2,
      history: null,
      planning: { from: '2024-01-01', to: '2024-12-31' },
    });
    const context = await contextForToken(token);
    const cases = [
      {
        command: {
          action: 'workout.update',
          id: workoutId,
          expectedRevision: 1,
          values: { schedule: { kind: 'independent', date: '2024-12-10' } },
        },
        from: '2024-06-15',
        to: '2024-12-10',
      },
      {
        command: {
          action: 'workout.update',
          id: workoutId,
          expectedRevision: 1,
          values: { schedule: { kind: 'independent', date: '2024-01-15' } },
        },
        from: '2024-01-15',
        to: '2024-06-15',
      },
      {
        command: {
          action: 'plan.create',
          values: { title: 'Dated plan', startDate: '2024-10-15' },
        },
        from: '2024-10-15',
        to: '2024-10-15',
      },
      {
        command: {
          action: 'plan.update',
          id: planId,
          expectedRevision: 1,
          values: { startDate: '2024-12-01' },
        },
        from: '2024-06-01',
        to: '2024-12-01',
      },
      {
        command: { action: 'plan.delete', id: planId, expectedRevision: 1 },
        from: '2024-06-01',
        to: '2024-06-01',
      },
    ];
    for (const [index, { command, from, to }] of cases.entries()) {
      const submitted = await submitProposal(token, {
        summary: `Date case ${index}`,
        commands: [command],
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      });
      const list = await readWorkspaceResponse({ from: '2024-01-01', to: '2024-12-31' });
      const item = list.proposals.find((proposal) => proposal.id === submitted.id)!;
      expect(item).toMatchObject({
        status: 'pending',
        affectedCount: 1,
        dateBounds: { from, to },
        changes: [],
      });
      const detail = await proposalDetails({ id: submitted.id });
      const overview = summarizeProposal(detail.changes);
      expect({ from: overview.from ?? null, to: overview.to ?? null }).toEqual(item.dateBounds);
      expect(detail.digest).toBe(submitted.digest);
    }
  });
  it('keeps caller errors for missing rows and rolls back invalid writes', async () => {
    const rows = await connection()<{ id: string }[]>`select id from training.records where false`;
    expect(optionalRow(rows)).toBeUndefined();
    expect(() => requiredRow(rows, new AppError('not_found', 'Missing', 404))).toThrowError(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
    await expect(
      transaction((tx) => trainingRepository.save('plan', { id: randomUUID(), revision: 1 }, tx)),
    ).rejects.toThrow();
    expect(await trainingRepository.list('plan')).toEqual([]);
  });
  it('keeps persistence and audit inside the caller transaction on a later failure', async () => {
    const result = applyCommands(
      emptyWorkspace(),
      [{ action: 'plan.create', values: { title: 'Rolled back' } }],
      { actor: 'owner' },
    );
    await expect(
      transaction(async (tx) => {
        await persistAndAudit(tx, result.changes, 'Synthetic rollback');
        throw new Error('Failure after audit');
      }),
    ).rejects.toThrow('Failure after audit');
    expect(await trainingRepository.list('plan')).toEqual([]);
    expect(await connection()`select id from host.changes`).toEqual([]);
  });
});
