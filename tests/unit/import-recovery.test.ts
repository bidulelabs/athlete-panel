import { expect, it } from 'vitest';
import { createSyncCursor, runSyncStep, type GarminSyncCursor } from '../../plugins/garmin/sync';
import { HEALTH_STREAMS } from '../../plugins/garmin/normalize';
import type { ImportStream } from '../../packages/contracts/src';
const day = '2026-10-24';
const cursor = (stream: ImportStream): GarminSyncCursor => ({
  ...createSyncCursor({
    today: day,
    earliestHealthDate: '2026-10-01',
    activityFrom: '2026-10-01',
    accountId: '555',
    targetStream: stream,
  }),
  phase: stream === 'activities' ? 'recent-activities' : 'recent-health',
  healthStreamIndex: stream === 'activities' ? 0 : HEALTH_STREAMS.indexOf(stream),
});
const activity = (id: string) => ({
  activityId: id,
  ownerId: '555',
  startTimeGMT: `${day}T12:00:00Z`,
  duration: 60,
});
const reader = (payload: unknown) => ({ get: async () => payload });
it('imports valid neighbours and advances by the raw page size through rejected rows', async () => {
  const first = await runSyncStep(
    cursor('activities'),
    reader([activity('10'), { ...activity('11'), startTimeGMT: 'bad' }, null]),
  );
  expect(first.activities).toHaveLength(1);
  expect(first.nextCursor.activityOffset).toBe(3);
  expect(first.coverage).toMatchObject({
    status: 'partial',
    rejectedRecords: 2,
    scanState: 'in-progress',
  });
  const last = await runSyncStep(first.nextCursor, reader([]));
  expect(last.coverage).toMatchObject({
    status: 'partial',
    rejectedRecords: 2,
    returnedRecords: 1,
    scanState: 'scanned',
  });
  expect(last.nextCursor.phase).toBe('done');
});
it('caps sanitized samples, never ends on an entirely rejected page, and detects its repetition', async () => {
  const payload = Array.from({ length: 75 }, () => ({
    activityId: 'private-bad-id',
    ownerId: '555',
    activityName: 'PRIVATE PAYLOAD',
  }));
  const first = await runSyncStep(cursor('activities'), reader(payload));
  expect(first.nextCursor.activityOffset).toBe(75);
  expect(first.coverage.diagnostics).toHaveLength(50);
  expect(JSON.stringify(first.coverage.diagnostics)).not.toContain('PRIVATE');
  expect(JSON.stringify(first.coverage.diagnostics)).not.toContain('private-bad-id');
  await expect(runSyncStep(first.nextCursor, reader(payload))).rejects.toMatchObject({
    code: 'pagination_stalled',
  });
  const last = await runSyncStep(first.nextCursor, reader([]));
  expect(last.coverage).toMatchObject({
    status: 'partial',
    returnedRecords: 0,
    rejectedRecords: 75,
    scanState: 'scanned',
  });
});
it('keeps malformed envelopes and every account-identity violation fatal', async () => {
  await expect(runSyncStep(cursor('activities'), reader({ records: [] }))).rejects.toMatchObject({
    code: 'invalid_payload',
  });
  await expect(
    runSyncStep(
      cursor('activities'),
      reader([activity('10'), { ownerId: '999', startTimeGMT: 'bad' }]),
    ),
  ).rejects.toMatchObject({ code: 'account_mismatch' });
  await expect(
    runSyncStep(cursor('activities'), reader([activity('10'), { ownerId: 'unsafe-identity' }])),
  ).rejects.toMatchObject({ code: 'invalid_payload' });
});
it('rejects invalid/out-of-window health rows individually and preserves null/zero and duplicate identity semantics', async () => {
  const result = await runSyncStep(
    cursor('sleep'),
    reader([
      { calendarDate: day, userProfilePk: '555', sleepTimeSeconds: 3600, deepSleepSeconds: 0 },
      { calendarDate: null, sleepTimeSeconds: 123 },
      { calendarDate: '2026-09-30', sleepTimeSeconds: 999 },
      { calendarDate: day, userProfilePk: '555', sleepTimeSeconds: 7200, deepSleepSeconds: 0 },
    ]),
  );
  expect(result.healthRecords).toHaveLength(6);
  expect(result.healthRecords.find((r) => r.metric === 'sleepDurationSeconds')?.value).toBe(7200);
  expect(result.healthRecords.find((r) => r.metric === 'sleepDeepSeconds')?.value).toBe(0);
  expect(result.healthRecords.find((r) => r.metric === 'sleepRemSeconds')?.value).toBeNull();
  expect(result.coverage).toMatchObject({
    scanState: 'scanned',
    status: 'partial',
    rejectedRecords: 2,
  });
  expect(result.nextCursor.phase).toBe('done');
});
