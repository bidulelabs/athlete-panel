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
const supplied = process.env.TEST_DATABASE_URL;
if (!supplied) throw new Error('Response integration checks require TEST_DATABASE_URL.');
const url = new URL(supplied);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
  throw new Error('Use isolated local *_test storage.');
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
