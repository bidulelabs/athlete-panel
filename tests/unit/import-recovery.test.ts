import { expect, it, vi } from 'vitest';
import {
  createSyncCursor,
  runSyncStep,
  parseSyncCursor,
  importsStream,
  type GarminSyncCursor,
} from '../../plugins/garmin/sync';
import { GarminError } from '../../plugins/garmin/transport';
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

it.each([{ targetStream: 'sleep' as const }, { scope: 'health' as const }])(
  'verifies old health imports against recent health without changing their bounds: %j',
  async (selection) => {
    const initial = createSyncCursor({
      today: '2019-03-20',
      earliestHealthDate: '2019-03-01',
      activityFrom: '2019-03-01',
      accountId: '555',
      timeZone: 'Europe/Paris',
      ...selection,
    });
    // It is already October 30 in the athlete's timezone, but still October 29 UTC.
    const now = new Date('2026-10-29T23:30:00Z');
    const get = vi.fn(async (path: string, query?: Record<string, unknown>) => {
      if (path.includes('/activities/')) throw new Error('Health imports must stay health-only');
      if (path.includes('dailysummaries')) return { data: [] };
      if (path.includes('/hrv/'))
        return path.endsWith('/2026-10-03/2026-10-30')
          ? { userProfilePk: '555', hrvSummaries: [] }
          : { hrvSummaries: [] };
      expect(query?.endDate).toBe('2019-03-20');
      return [];
    });
    const identity = await runSyncStep(initial, { get }, now);
    expect(identity.nextCursor).toMatchObject({
      accountId: '555',
      phase: 'recent-health',
      today: initial.today,
      earliestHealthDate: initial.earliestHealthDate,
      activityFrom: initial.activityFrom,
    });
    expect(get.mock.calls[0]).toEqual([
      '/usersummary-service/v2/dailysummaries',
      { startDate: '2026-10-03', endDate: '2026-10-30' },
    ]);
    const data = await runSyncStep(identity.nextCursor, { get }, now);
    expect(data.coverage).toMatchObject({ stream: 'sleep', to: '2019-03-20', status: 'no-data' });
    expect(data.activities).toEqual([]);
    expect(data.healthRecords).toEqual([]);
    await expect(
      runSyncStep(
        initial,
        {
          get: async (path) =>
            path.includes('dailysummaries')
              ? { data: [{ userProfilePk: '999' }] }
              : { hrvSummaries: [] },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'account_mismatch' });
  },
);
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
  for (const alias of ['999', 'malformed-identity']) {
    await expect(
      runSyncStep(
        cursor('sleep'),
        reader([
          { calendarDate: day, userProfilePk: '555', userProfilePK: alias, sleepTimeSeconds: 3600 },
        ]),
      ),
    ).rejects.toMatchObject({ code: alias === '999' ? 'account_mismatch' : 'invalid_payload' });
  }
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

it.each(['activities', 'health', 'both', undefined] as const)(
  'traverses bounded %s refreshes with family-specific identity probes and resumable windows',
  async (scope) => {
    let current = createSyncCursor({
      today: day,
      earliestHealthDate: '2026-08-01',
      activityFrom: '2026-08-01',
      scope,
    });
    const get = vi.fn(async (path: string, query?: Record<string, unknown>) => {
      if (path.includes('/activities/')) return query?.limit === 1 ? [activity('10')] : [];
      if (path.includes('dailysummaries')) return { data: [] };
      if (path.includes('/hrv/')) return { userProfilePk: '555', hrvSummaries: [] };
      return [];
    });
    const windows: Array<{ stream: string; from: string | null; to: string }> = [];
    for (let steps = 0; current.phase !== 'done' && steps < 100; steps++) {
      const result = await runSyncStep(current, { get });
      if (result.coverage.stream !== 'identity') windows.push(result.coverage);
      current = parseSyncCursor(JSON.parse(JSON.stringify(result.nextCursor)));
    }
    expect(current.phase).toBe('done');
    const paths = get.mock.calls.map(([path]) => path);
    if (scope === 'activities') {
      expect(paths.every((path) => path.includes('/activities/'))).toBe(true);
      expect(windows).toMatchObject([{ stream: 'activities', from: '2026-08-01', to: day }]);
      expect(importsStream(current, 'sleep')).toBe(false);
    } else {
      for (const stream of HEALTH_STREAMS) {
        const ranges = windows.filter((window) => window.stream === stream);
        expect(ranges.at(-1)?.from).toBe('2026-08-01');
        expect(ranges[0]?.to).toBe(day);
        for (const range of ranges)
          expect((Date.parse(range.to) - Date.parse(range.from!)) / 86400000).toBeLessThan(28);
      }
      if (scope === 'health') {
        expect(paths.every((path) => !path.includes('/activities/'))).toBe(true);
        expect(importsStream(current, 'activities')).toBe(false);
      } else expect(windows.some((window) => window.stream === 'activities')).toBe(true);
    }
  },
);

it.each(['empty', 'forbidden', 'missing identity'])(
  'activity-only identity %s never falls back to health',
  async (response) => {
    const get = vi.fn(async () => {
      if (response === 'forbidden') throw new GarminError('forbidden', 'Unavailable');
      return response === 'empty' ? [] : [{ activityId: '10' }];
    });
    for (const selection of [
      { scope: 'activities' as const },
      { targetStream: 'activities' as const },
    ]) {
      get.mockClear();
      await expect(
        runSyncStep(createSyncCursor({ today: day, earliestHealthDate: day, ...selection }), {
          get,
        }),
      ).rejects.toMatchObject({ code: 'account_identity_unavailable' });
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith(
        '/activitylist-service/activities/search/activities',
        expect.any(Object),
      );
    }
  },
);
