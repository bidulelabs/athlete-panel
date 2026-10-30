import { describe, expect, it } from 'vitest';
import { operationalHealth } from '../../packages/ui/src/operational-status';
import { proposalRows } from '../../plugins/agent-bridge/proposal-diff';
import { workoutSchema, type EntityChange } from '@athlete-panel/contracts';

const workout = workoutSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  title: 'Easy run',
  sport: 'running',
  schedule: { kind: 'independent', date: '2026-10-25' },
  durationSeconds: 1800,
  distanceMeters: 5000,
});
describe('owner operational feedback', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it('distinguishes absent, healthy, stale and failed processes/backups', () => {
    expect(operationalHealth({}, now)).toMatchObject({
      workerWarning: true,
      backup: 'Backups are not configured',
    });
    const recent = {
      worker: { lastSeen: '2026-10-25T11:59:40Z' },
      lastBackup: { completedAt: '2026-10-25T03:00:00Z' },
    };
    expect(
      operationalHealth({ ...recent, worker: { ...recent.worker, state: 'failed' } }, now),
    ).toMatchObject({ worker: 'Worker needs attention', workerWarning: true });
    expect(operationalHealth(recent, now)).toMatchObject({
      workerWarning: false,
      backupWarning: true,
      backup: 'Archive available; off-host protection not verified',
    });
    expect(
      operationalHealth(
        {
          ...recent,
          lastBackup: {
            ...recent.lastBackup,
            storage: 'remote-mount',
            verifiedAt: recent.lastBackup.completedAt,
          },
        },
        now,
      ),
    ).toMatchObject({ backupWarning: false, backupInfo: null });
    const local = {
      ...recent,
      lastBackup: {
        ...recent.lastBackup,
        storage: 'local',
        verifiedAt: recent.lastBackup.completedAt,
      },
    };
    expect(operationalHealth(local, now)).toMatchObject({
      backup: 'Local backup verified; off-server copy not configured',
      backupWarning: false,
      backupInfo: expect.stringContaining(
        'Local backups do not protect against losing this server.',
      ),
    });
    expect(operationalHealth({ ...local, backupAttempt: { state: 'failed' } }, now).backup).toBe(
      'Last backup attempt failed',
    );
    expect(operationalHealth(local, now + 27 * 3600000).backup).toBe('Backup is overdue');
    expect(
      operationalHealth({ ...recent, worker: { ...recent.worker, state: 'maintenance' } }, now),
    ).toMatchObject({ worker: 'Paused for maintenance', workerWarning: false });
    expect(operationalHealth(recent, now + 27 * 3600000)).toMatchObject({
      workerWarning: true,
      backup: 'Backup is overdue',
    });
    expect(operationalHealth({ ...recent, backupAttempt: { state: 'failed' } }, now).backup).toBe(
      'Last backup attempt failed',
    );
    expect(
      operationalHealth(
        { backupAttempt: { state: 'running', startedAt: '2026-10-24T12:00:00Z' } },
        now,
      ).backup,
    ).toBe('Backup may be stalled');
  });
  it.each([
    {
      name: 'failed',
      input: { backupAttempt: { state: 'failed' } },
      message: 'Last backup attempt failed',
    },
    {
      name: 'stalled',
      input: { backupAttempt: { state: 'running', startedAt: '2026-10-24T12:00:00Z' } },
      message: 'Backup may be stalled',
    },
    { name: 'missing', input: { lastBackup: null }, message: 'Backups are not configured' },
    {
      name: 'first backup pending',
      input: { lastBackup: null, backupSchedule: { nextRunAt: '2026-10-26T03:00:00Z' } },
      message: 'Waiting for first successful backup',
    },
    {
      name: 'overdue',
      input: {
        lastBackup: {
          storage: 'local',
          completedAt: '2026-10-23T03:00:00Z',
          verifiedAt: '2026-10-23T03:00:00Z',
        },
      },
      message: 'Backup is overdue',
    },
    {
      name: 'unverified',
      input: { lastBackup: { storage: 'local', completedAt: '2026-10-25T03:00:00Z' } },
      message: 'Archive available; off-host protection not verified',
    },
  ])('keeps $name backups actionable even when local mode was healthy', ({ input, message }) => {
    const healthy = {
      lastBackup: {
        storage: 'local',
        completedAt: '2026-10-25T03:00:00Z',
        verifiedAt: '2026-10-25T03:00:00Z',
      },
    };
    expect(operationalHealth({ ...healthy, ...input }, now)).toMatchObject({
      backup: message,
      backupWarning: true,
      backupInfo: null,
    });
  });
  it('keeps an active backup informational until it stalls', () => {
    expect(
      operationalHealth(
        {
          lastBackup: {
            storage: 'local',
            completedAt: '2026-10-25T03:00:00Z',
            verifiedAt: '2026-10-25T03:00:00Z',
          },
          backupAttempt: { state: 'running', startedAt: '2026-10-25T11:59:00Z' },
        },
        now,
      ),
    ).toMatchObject({ backup: 'Backup in progress', backupWarning: false, backupInfo: null });
  });
});
describe('complete, readable proposal review', () => {
  it('shows changed duration, distance and ordering with units and leaves unchanged fields out', () => {
    const change: EntityChange = {
      entity: 'workout',
      id: workout.id,
      before: workout,
      after: { ...workout, revision: 2, durationSeconds: 2700, distanceMeters: null, order: 2 },
    };
    expect(proposalRows(change)).toEqual([
      { field: 'Duration', before: '30 min', after: '45 min' },
      { field: 'Distance', before: '5 km', after: 'Not set' },
      { field: 'Position in day', before: '1', after: '2' },
    ]);
    expect(proposalRows(change, 'imperial')[1].before).toContain('mi');
  });
  it('shows derived plan dates even when no stored field changes', () => {
    expect(
      proposalRows({
        entity: 'workout',
        id: workout.id,
        before: workout,
        after: workout,
        beforeEffectiveDate: '2026-10-25',
        afterEffectiveDate: '2026-10-26',
      }),
    ).toEqual([{ field: 'Calendar date', before: '2026-10-25', after: '2026-10-26' }]);
  });
  it('expands interval targets, creations and deletions without losing fields', () => {
    const after = {
      ...workout,
      steps: [
        {
          kind: 'repeat' as const,
          times: 3,
          steps: [
            {
              kind: 'work' as const,
              durationSeconds: 60,
              distanceMeters: null,
              notes: '',
              target: { kind: 'heartRateBpm' as const, min: 140, max: 160 },
            },
          ],
        },
      ],
    };
    const rows = proposalRows({ entity: 'workout', id: workout.id, before: null, after });
    expect(rows).toContainEqual({
      field: 'Intervals · Step 1 · Intervals · Step 1 · Target · Maximum',
      before: 'Not present',
      after: '160 bpm',
    });
    const removed = proposalRows({ entity: 'workout', id: workout.id, before: after, after: null });
    expect(removed.some((row) => row.field === 'Title' && row.after === 'Not present')).toBe(true);
    const extra = { ...workout, futureField: 'Keep visible' };
    expect(
      proposalRows({ entity: 'workout', id: workout.id, before: workout, after: extra }),
    ).toContainEqual({ field: 'Future Field', before: 'Not present', after: 'Keep visible' });
  });
});
