import { describe, expect, it, vi } from 'vitest';
import {
  createGarminClient,
  parseGarminJson,
  retryAfterMilliseconds,
  GarminError,
  GARMIN_ORIGIN,
  GARMIN_TOKEN_PATH,
  type CachedGarminToken,
  type GarminReader,
} from '../../plugins/garmin/transport';
import {
  normalizeActivities,
  normalizeHealth,
  accountIds,
  assertAccountBinding,
} from '../../plugins/garmin/normalize';
import {
  createSyncCursor,
  runSyncStep,
  getAccountIdentity,
  healthRequest,
  type GarminSyncCursor,
} from '../../plugins/garmin/sync';
import {
  automaticHealthHistoryStart,
  GARMIN_HEALTH_HISTORY_START,
} from '../../plugins/garmin/history-policy';

const NOW = Date.parse('2026-10-24T10:00:00Z');
const path = '/activitylist-service/activities/search/activities';
const token = (expiry = NOW + 3_600_000) =>
  `synthetic.${Buffer.from(JSON.stringify({ exp: expiry / 1000 })).toString('base64url')}.signature`;
const reply = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers,
  });
function transport(responses: Response[]) {
  const mock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    return response;
  });
  return { fetcher: mock as unknown as typeof fetch, mock };
}
const activity = (extra = {}) => ({
  activityId: '9007199254740993123',
  ownerId: '555',
  activityName: 'Evening ride',
  activityType: { typeKey: 'road_biking' },
  startTimeGMT: '2026-10-24 23:30:00',
  startTimeLocal: '2026-10-25 01:30:00',
  duration: 3600,
  distance: 20_000,
  ...extra,
});
const cursor = (extra: Partial<GarminSyncCursor> = {}) => ({
  ...createSyncCursor({
    today: '2026-10-24',
    earliestHealthDate: '2026-08-01',
    timeZone: 'Europe/Paris',
    accountId: '555',
  }),
  ...extra,
});

describe('Garmin Personal transport', () => {
  it('exchanges ApiKey for a plain JWT, caches it and uses fixed-origin bearer GETs', async () => {
    const { fetcher, mock } = transport([reply(token()), reply([]), reply([])]);
    const client = createGarminClient({
      apiKey: 'private-key',
      credentialGeneration: 1,
      fetch: fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    });
    await client.get(path, { limit: 1 });
    await client.get(path);
    const calls = mock.mock.calls as unknown as [URL, RequestInit][];
    expect(calls).toHaveLength(3);
    expect(calls[0][0].toString()).toBe(GARMIN_ORIGIN + GARMIN_TOKEN_PATH);
    expect(calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'ApiKey private-key' },
    });
    expect(calls[1][1].headers).toMatchObject({ Authorization: `Bearer ${token()}` });
  });
  it('reissues once after 401 and then fails closed', async () => {
    const { fetcher, mock } = transport([
      reply(token()),
      reply('secret response', 401),
      reply(token()),
      reply('secret response', 401),
    ]);
    const client = createGarminClient({
      apiKey: 'private-key',
      credentialGeneration: 1,
      fetch: fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    });
    await expect(client.get(path)).rejects.toMatchObject({
      code: 'credentials_rejected',
      status: 401,
    });
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it('uses encrypted-store callbacks and invalidates expired or replaced credentials', async () => {
    let cached: CachedGarminToken | null = null;
    const cache = {
      load: async () => cached,
      save: async (value: CachedGarminToken) => {
        cached = value;
      },
    };
    const first = transport([reply(token()), reply([])]);
    await createGarminClient({
      apiKey: 'key-a',
      credentialGeneration: 1,
      tokenCache: cache,
      fetch: first.fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    }).get(path);
    const second = transport([reply([])]);
    await createGarminClient({
      apiKey: 'key-a',
      credentialGeneration: 1,
      tokenCache: cache,
      fetch: second.fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    }).get(path);
    expect(second.mock).toHaveBeenCalledTimes(1);
    const changed = transport([reply(token()), reply([])]);
    await createGarminClient({
      apiKey: 'key-b',
      credentialGeneration: 2,
      tokenCache: cache,
      fetch: changed.fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    }).get(path);
    expect(changed.mock).toHaveBeenCalledTimes(2);
    const expired = transport([reply(token(NOW + 10_800_000)), reply([])]);
    await createGarminClient({
      apiKey: 'key-b',
      credentialGeneration: 2,
      tokenCache: cache,
      fetch: expired.fetcher,
      now: () => NOW + 3_600_000,
      requestIntervalMs: 0,
    }).get(path);
    expect(expired.mock).toHaveBeenCalledTimes(2);
  });
  it('returns retry timing without leaking provider bodies or credentials', async () => {
    const { fetcher } = transport([
      reply(token()),
      reply('private-key raw GPS/body', 429, { 'Retry-After': '125' }),
    ]);
    const client = createGarminClient({
      apiKey: 'private-key',
      credentialGeneration: 1,
      fetch: fetcher,
      now: () => NOW,
      requestIntervalMs: 0,
    });
    let error: unknown;
    try {
      await client.get(path);
    } catch (value) {
      error = value;
    }
    expect(error).toMatchObject({ code: 'rate_limited', retryAfterMs: 125_000, retryable: true });
    expect(String(error)).not.toMatch(/private-key|GPS/);
    expect(retryAfterMilliseconds(new Date(NOW + 120_000).toUTCString(), NOW)).toBe(120_000);
    expect(retryAfterMilliseconds('not-a-date', NOW)).toBeNull();
  });
  it('does not classify denied key exchange as an unavailable health stream', async () => {
    const { fetcher } = transport([reply('no permission', 403)]);
    await expect(
      createGarminClient({
        apiKey: 'key',
        credentialGeneration: 1,
        fetch: fetcher,
        now: () => NOW,
      }).get(path),
    ).rejects.toMatchObject({ code: 'credentials_rejected' });
  });
  it('serializes simultaneous calls and paces each HTTP request', async () => {
    let clock = NOW;
    const waits: number[] = [];
    const { fetcher, mock } = transport([reply(token()), reply([]), reply([])]);
    const client = createGarminClient({
      apiKey: 'key',
      credentialGeneration: 1,
      fetch: fetcher,
      now: () => clock,
      requestIntervalMs: 50,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    });
    await Promise.all([client.get(path), client.get(path)]);
    expect(waits).toEqual([50, 50]);
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it('rejects outbound writes, alternate hosts and redirects', async () => {
    const { fetcher, mock } = transport([]);
    const client = createGarminClient({ apiKey: 'key', credentialGeneration: 1, fetch: fetcher });
    for (const route of [
      'https://example.com/steal',
      '//example.com/steal',
      '/workout-service/workout',
      `${path}?x=1`,
    ]) {
      await expect(client.get(route)).rejects.toMatchObject({ code: 'invalid_configuration' });
    }
    expect(mock).not.toHaveBeenCalled();
  });
  it('honors cancellation before sending and bounds in-flight requests', async () => {
    const abort = new AbortController();
    abort.abort();
    const { fetcher, mock } = transport([]);
    await expect(
      createGarminClient({
        apiKey: 'key',
        credentialGeneration: 1,
        fetch: fetcher,
        signal: abort.signal,
      }).get(path),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(mock).not.toHaveBeenCalled();
    const hung = ((_url: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new Error('network details/private-key')),
        ),
      )) as typeof fetch;
    await expect(
      createGarminClient({ apiKey: 'key', credentialGeneration: 1, fetch: hung, timeoutMs: 5 }).get(
        path,
      ),
    ).rejects.toMatchObject({ code: 'request_timeout', retryable: true });
  });
  it('preserves int64 IDs before JSON parsing can round them', () => {
    const data = parseGarminJson(
      '{"activityId":9007199254740993123,"ownerId":9007199254740993124}',
    );
    expect(data).toEqual({ activityId: '9007199254740993123', ownerId: '9007199254740993124' });
    expect(() => parseGarminJson('{"__proto__":{"admin":true}}')).toThrow(GarminError);
  });
});

describe('Garmin normalization', () => {
  it('retains provider local day across midnight/DST, UTC instant, canonical units and missing values', () => {
    const result = normalizeActivities(
      [activity({ elevationGain: null, averageHR: null })],
      'America/Los_Angeles',
    )[0];
    expect(result).toMatchObject({
      externalId: '9007199254740993123',
      localDate: '2026-10-25',
      dateSource: 'provider',
      startedAt: '2026-10-24T23:30:00.000Z',
      sport: 'cycling',
      durationSeconds: 3600,
      distanceMeters: 20_000,
      elevationMeters: null,
      averageHeartRateBpm: null,
    });
    expect(result).not.toHaveProperty('ownerId');
    expect(result).not.toHaveProperty('startLatitude');
  });
  it('marks timezone fallback explicitly and rejects rounded IDs, impossible dates and absent GMT', () => {
    expect(
      normalizeActivities([activity({ startTimeLocal: null })], 'Europe/Paris')[0],
    ).toMatchObject({ localDate: '2026-10-25', dateSource: 'inferred' });
    expect(() => normalizeActivities([activity({ activityId: 9007199254740992 })])).toThrow(
      GarminError,
    );
    expect(() => normalizeActivities([activity({ startTimeGMT: '2026-02-30 10:00:00' })])).toThrow(
      GarminError,
    );
    expect(() => normalizeActivities([activity({ startTimeGMT: undefined })])).toThrow(GarminError);
  });
  it('normalizes selected sleep duration/stages/score while retaining unknowns and known zero', () => {
    const rows = normalizeHealth('sleep', [
      {
        calendarDate: '2026-10-24',
        sleepTimeSeconds: 28_800,
        deepSleepSeconds: 0,
        lightSleepSeconds: 20_000,
        remSleepSeconds: null,
        sleepScores: { overall: { value: 80 } },
      },
    ]);
    const value = (metric: string) => rows.find((row) => row.metric === metric)?.value;
    expect(rows).toHaveLength(6);
    expect(value('sleepDurationSeconds')).toBe(28_800);
    expect(value('sleepDeepSeconds')).toBe(0);
    expect(value('sleepRemSeconds')).toBeNull();
    expect(value('sleepAwakeSeconds')).toBeNull();
    expect(value('sleepScore')).toBe(80);
  });
  it('ignores explicit undated empty overnight DTOs without guessing dates from nap metadata', async () => {
    const empty = {
      id: null,
      userProfilePK: null,
      calendarDate: null,
      sleepTimeSeconds: null,
      sleepStartTimestampGMT: null,
      sleepEndTimestampGMT: null,
      sleepStartTimestampLocal: null,
      sleepEndTimestampLocal: null,
      deepSleepSeconds: null,
      lightSleepSeconds: null,
      remSleepSeconds: null,
      awakeSleepSeconds: null,
      deviceRemCapable: false,
      retro: false,
    };
    const rows = [
      { calendarDate: '2026-08-03', sleepTimeSeconds: 28_800, deepSleepSeconds: 0 },
      { ...empty, sleepNeed: { baseline: 480 } },
      { ...empty, nextSleepNeed: { baseline: 480 } },
      {
        ...empty,
        napTimeSeconds: 1800,
        dailyNapDTOS: [{ calendarDate: '2026-08-04', duration: 1800 }],
      },
    ];
    const normalized = normalizeHealth('sleep', rows);
    expect(normalized).toHaveLength(6);
    expect(normalized.every((row) => row.localDate === '2026-08-03')).toBe(true);
    expect(normalized.find((row) => row.metric === 'sleepDeepSeconds')?.value).toBe(0);
    const step = await runSyncStep(
      cursor({
        phase: 'history-health',
        windowEnd: '2026-08-22',
        earliestHealthDate: '2026-01-01',
      }),
      { get: async () => rows },
    );
    expect(step.coverage).toMatchObject({
      stream: 'sleep',
      from: '2026-07-26',
      to: '2026-08-22',
      returnedRecords: 6,
      missingDays: 27,
      unknownMetrics: 166,
      status: 'partial',
    });
    expect(step.nextCursor.healthStreamIndex).toBe(1);
    const missing = await runSyncStep(
      cursor({ phase: 'history-health', windowEnd: '2026-08-22' }),
      { get: async () => [empty] },
    );
    expect(missing.healthRecords).toEqual([]);
    expect(missing.coverage).toMatchObject({
      status: 'no-data',
      missingDays: 22,
      unknownMetrics: 132,
    });
  });
  it('still rejects undated actual sleep, absent DTO fields and malformed calendar dates', () => {
    const empty = {
      id: null,
      calendarDate: null,
      sleepTimeSeconds: null,
      sleepStartTimestampGMT: null,
      sleepEndTimestampGMT: null,
    };
    for (const malformed of [
      {},
      { calendarDate: null },
      { ...empty, id: '123' },
      { ...empty, sleepTimeSeconds: 0 },
      { ...empty, deepSleepSeconds: 100 },
      { ...empty, sleepEndTimestampGMT: '2026-08-03T08:00:00Z' },
      { ...empty, sleepScores: { overall: { value: 80 } } },
      { ...empty, unknownOvernightValue: 30 },
      { ...empty, calendarDate: '2026-02-30' },
      { ...empty, calendarDate: '' },
    ]) {
      expect(() => normalizeHealth('sleep', [malformed])).toThrow(
        /Garmin sleep record.*calendar date/,
      );
    }
    expect(() => normalizeHealth('steps', [empty])).toThrow(/Garmin steps record.*calendar date/);
    const dated = normalizeHealth('sleep', [{ ...empty, calendarDate: '2026-08-03' }]);
    expect(dated).toHaveLength(6);
    expect(dated.every((row) => row.value === null)).toBe(true);
  });
  it('maps the documented daily, HRV, steps and stress response envelopes', () => {
    expect(
      normalizeHealth('daily', {
        data: [{ calendarDate: '2026-10-24', heartRate: { restingValue: 48 } }],
      })[0].value,
    ).toBe(48);
    expect(
      normalizeHealth('hrv', {
        userProfilePk: '555',
        hrvSummaries: [{ calendarDate: '2026-10-24', lastNightAvg: 60 }],
      })[0].value,
    ).toBe(60);
    expect(normalizeHealth('steps', [{ calendarDate: '2026-10-24', totalSteps: 0 }])[0].value).toBe(
      0,
    );
    expect(
      normalizeHealth('stress', [
        { calendarDate: '2026-10-24', values: { overallStressLevel: -1 } },
      ])[0].value,
    ).toBeNull();
    expect(() => normalizeHealth('steps', { unexpected: [] })).toThrow(GarminError);
  });
  it('uses Body Battery column descriptors and latest timestamp, never array position assumptions', () => {
    const rows = normalizeHealth('bodyBattery', [
      {
        date: '2026-10-24',
        bodyBatteryValueDescriptorDTOList: [
          { bodyBatteryValueDescriptorKey: 'bodyBatteryLevel', bodyBatteryValueDescriptorIndex: 0 },
          { bodyBatteryValueDescriptorKey: 'timestamp', bodyBatteryValueDescriptorIndex: 1 },
        ],
        bodyBatteryValuesArray: [
          [75, 500],
          [25, 900],
          [90, 100],
        ],
      },
    ]);
    expect(rows[0]).toMatchObject({ value: 25, measuredAt: null });
    expect(
      normalizeHealth('bodyBattery', [{ date: '2026-10-24', bodyBatteryValuesArray: [[0, 99]] }])[0]
        .value,
    ).toBeNull();
  });
  it('checks stable account identities and rejects mixed-account batches', () => {
    expect(accountIds({ userProfilePk: '555', hrvSummaries: [] }, 'hrv')).toEqual(['555']);
    expect(assertAccountBinding('555', [])).toBe('555');
    expect(() => assertAccountBinding('555', ['999'])).toThrow(/different account/);
    expect(() => assertAccountBinding(null, ['555', '999'])).toThrow(/different account/);
  });
});

describe('resumable Garmin pulls', () => {
  it('uses an automatic boundary and traverses empty periods to the first supported scan day', async () => {
    expect(automaticHealthHistoryStart()).toBe('2000-01-01');
    expect(automaticHealthHistoryStart('2026-01-01')).toBe('2000-01-01');
    expect(automaticHealthHistoryStart('1999-01-01')).toBe('1999-01-01');
    const requested: Array<[string, string]> = [];
    let state = {
      ...createSyncCursor({
        today: '2000-03-05',
        earliestHealthDate: GARMIN_HEALTH_HISTORY_START,
        accountId: '555',
      }),
      phase: 'recent-health' as const,
    } as GarminSyncCursor;
    const reader: GarminReader = {
      get: async (route, query) => {
        if (query?.startDate && query?.endDate)
          requested.push([String(query.startDate), String(query.endDate)]);
        if (route.includes('dailysummaries')) return { data: [] };
        if (route.includes('/hrv/')) return { userProfilePk: '555', hrvSummaries: [] };
        return [];
      },
    };
    let windows = 0;
    while (state.phase !== 'done' && windows < 100) {
      state = (await runSyncStep(state, reader)).nextCursor;
      windows++;
    }
    expect(state.phase).toBe('done');
    expect(requested.some(([from]) => from === GARMIN_HEALTH_HISTORY_START)).toBe(true);
    expect(requested.every(([from, to]) => from >= GARMIN_HEALTH_HISTORY_START && from <= to)).toBe(
      true,
    );
    expect(state.windowEnd).toBe('1999-12-31');
  });

  it('validates date bounds and uses documented Personal endpoints within their shortest range limit', () => {
    expect(() =>
      createSyncCursor({ today: '2026-10-24', earliestHealthDate: '2026-10-25' }),
    ).toThrow(GarminError);
    expect(() => healthRequest('sleep', '2026-09-01', '2026-10-24')).toThrow(GarminError);
    expect(healthRequest('steps', '2026-10-01', '2026-10-28').path).toBe(
      '/usersummary-service/stats/steps/daily/2026-10-01/2026-10-28',
    );
    expect(() =>
      createSyncCursor({
        today: '2026-10-24',
        earliestHealthDate: '2026-10-01',
        activityFrom: '2026-10-25',
      }),
    ).toThrow(GarminError);
    expect(() =>
      createSyncCursor({
        today: '2026-10-24',
        earliestHealthDate: '2026-10-01',
        activityFrom: '2026-02-30',
      }),
    ).toThrow(GarminError);
  });

  it('bounds targeted recent and older activity searches while retaining the seven-day partition', async () => {
    const get = vi.fn(async () => []);
    const recent = await runSyncStep(
      cursor({ phase: 'recent-activities', activityFrom: '2026-10-22' }),
      { get },
    );
    expect(get).toHaveBeenLastCalledWith(
      path,
      expect.objectContaining({ startDate: '2026-10-22', endDate: '2026-10-24' }),
    );
    expect(recent.coverage.from).toBe('2026-10-22');
    const older = await runSyncStep(
      cursor({ phase: 'history-activities', activityFrom: '2026-10-01' }),
      { get },
    );
    expect(get).toHaveBeenLastCalledWith(
      path,
      expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-17' }),
    );
    expect(older.coverage.from).toBe('2026-10-01');
    await runSyncStep(cursor({ phase: 'history-activities', activityFrom: '2026-10-17' }), { get });
    expect(get).toHaveBeenLastCalledWith(
      path,
      expect.objectContaining({ startDate: '2026-10-17', endDate: '2026-10-17' }),
    );
  });

  it.each(['2026-10-18', '2026-10-22'])(
    'skips older activity traversal when the whole target starts within the recent window (%s)',
    async (activityFrom) => {
      const get = vi.fn(async (_route: string) => null);
      const state = createSyncCursor({
        today: '2026-10-24',
        earliestHealthDate: activityFrom,
        activityFrom,
        accountId: '555',
      });
      const step = await runSyncStep(
        { ...state, phase: 'recent-health', healthStreamIndex: 5 },
        { get },
      );
      expect(step.nextCursor.phase).toBe('done');
      expect(get).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0]?.[0]).not.toBe(path);
    },
  );
  it('finds an identity without profile names and blocks another account before writes', async () => {
    const reader: GarminReader = {
      get: async (route) =>
        route === path ? [] : { data: [{ userProfilePk: '555', calendarDate: '2026-10-24' }] },
    };
    expect(await getAccountIdentity(reader, '2026-10-24')).toBe('555');
    await expect(runSyncStep(cursor({ accountId: '999' }), reader)).rejects.toMatchObject({
      code: 'account_mismatch',
    });
  });
  it('does not import unbound health records when no stable account identity is available', async () => {
    const reader: GarminReader = {
      get: async (route) =>
        route === path ? [] : route.includes('dailysummaries') ? { data: [] } : null,
    };
    await expect(runSyncStep(cursor({ accountId: null }), reader)).rejects.toMatchObject({
      code: 'account_identity_unavailable',
    });
  });
  it('advances actual offset until an empty page, even below requested page size; retry is repeat-safe', async () => {
    const reader: GarminReader = { get: async () => [activity()] };
    const start = cursor({ phase: 'recent-activities' });
    const one = await runSyncStep(start, reader);
    const replay = await runSyncStep(start, reader);
    expect(one).toEqual(replay);
    expect(one.nextCursor.activityOffset).toBe(1);
    expect(one.nextCursor.phase).toBe('recent-activities');
    expect(start.activityOffset).toBe(0);
    await expect(runSyncStep(one.nextCursor, reader)).rejects.toMatchObject({
      code: 'pagination_stalled',
    });
  });
  it('retains input cursor on interruption and diagnoses an out-of-window record', async () => {
    const start = cursor({ phase: 'recent-health' });
    const before = structuredClone(start);
    await expect(
      runSyncStep(start, {
        get: async () => {
          throw new GarminError('rate_limited', 'retry', 429, 1000, true);
        },
      }),
    ).rejects.toMatchObject({ retryable: true });
    expect(start).toEqual(before);
    const rejected = await runSyncStep(start, {
      get: async () => [{ calendarDate: '2025-10-01' }],
    });
    expect(rejected.coverage).toMatchObject({
      status: 'partial',
      scanState: 'scanned',
      rejectedRecords: 1,
    });
    expect(start).toEqual(before);
  });
  it('continues through empty historical health ranges to the earliest owner date', async () => {
    const requests: { route: string; query?: Record<string, unknown> }[] = [];
    const reader: GarminReader = {
      get: async (route, query) => {
        requests.push({ route, query });
        if (route === path) return query?.limit === 1 ? [activity()] : [];
        if (route.includes('dailysummaries')) return { data: [] };
        if (route.includes('/hrv/')) return { userProfilePk: '555', hrvSummaries: [] };
        return [];
      },
    };
    let state = cursor();
    const coverage = [];
    for (let safety = 0; state.phase !== 'done' && safety < 100; safety++) {
      const step = await runSyncStep(state, reader);
      state = step.nextCursor;
      coverage.push(step.coverage);
    }
    expect(state.phase).toBe('done');
    expect(coverage.filter((row) => row.stream === 'sleep')).toHaveLength(4);
    expect(coverage.some((row) => row.from === '2026-08-01')).toBe(true);
    expect(
      coverage
        .filter((row) => row.stream === 'sleep')
        .every((row) => row.status === 'no-data' && row.unknownMetrics > 0),
    ).toBe(true);
    const historySearch = requests.find(
      (request) => request.route === path && request.query?.endDate === '2026-10-17',
    );
    expect(historySearch?.query).not.toHaveProperty('startDate');
  });
  it('marks denied health streams unavailable while continuing other streams and avoids repeated denied calls in the run', async () => {
    const denied = {
      get: vi.fn(async () => {
        throw new GarminError('forbidden', 'denied', 403);
      }),
    };
    const start = cursor({ phase: 'recent-health' });
    const step = await runSyncStep(start, denied);
    expect(step.coverage).toMatchObject({ stream: 'sleep', status: 'unavailable' });
    expect(step.nextCursor.healthStreamIndex).toBe(1);
    expect(start.unavailableStreams).toEqual([]);
    const laterWindow = {
      ...step.nextCursor,
      phase: 'history-health' as const,
      healthStreamIndex: 0,
      windowEnd: '2026-10-17',
    };
    expect((await runSyncStep(laterWindow, denied)).coverage.status).toBe('unavailable');
    expect(denied.get).toHaveBeenCalledTimes(1);
  });
  it('finishes a scheduled recent run without restarting historical backfill', async () => {
    const end = cursor({ mode: 'recent', phase: 'recent-health', healthStreamIndex: 5 });
    const step = await runSyncStep(end, { get: async () => null });
    expect(step.nextCursor.phase).toBe('done');
  });
});
