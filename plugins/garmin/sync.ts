import { createHash } from 'node:crypto';
import { GarminError, type GarminQuery, type GarminReader } from './transport';
import {
  HEALTH_STREAMS,
  accountIds,
  assertAccountBinding,
  dayKey,
  normalizeActivities,
  normalizeHealth,
  streamMetrics,
  type HealthStream,
  type ImportedActivity,
  type ImportedHealthRecord,
} from './normalize';

export type SyncPhase =
  | 'identity'
  | 'recent-activities'
  | 'recent-health'
  | 'history-activities'
  | 'history-health'
  | 'done';
export type GarminSyncCursor = {
  version: 1;
  mode: 'initial' | 'recent';
  phase: SyncPhase;
  today: string;
  earliestHealthDate: string;
  /** Present only for an explicitly bounded reimport; omitted for all-available activity history. */
  activityFrom?: string;
  timeZone: string;
  accountId: string | null;
  activityOffset: number;
  previousPageFingerprint: string | null;
  healthStreamIndex: number;
  windowEnd: string;
  unavailableStreams: Array<HealthStream | 'activities'>;
};
export type SyncCoverage = {
  stream: 'identity' | 'activities' | HealthStream;
  phase: SyncPhase;
  from: string | null;
  to: string;
  returnedRecords: number;
  missingDays: number;
  unknownMetrics: number;
  oldestReturnedDate: string | null;
  status: 'available' | 'partial' | 'no-data' | 'complete' | 'unavailable';
  errorCode?: 'forbidden';
};
export type GarminSyncStep = {
  activities: ImportedActivity[];
  healthRecords: ImportedHealthRecord[];
  nextCursor: GarminSyncCursor;
  coverage: SyncCoverage;
  accountId: string | null;
};
export const ACTIVITY_PAGE_SIZE = 99;

export function addDays(date: string, days: number): string {
  if (!dayKey(date))
    throw new GarminError('invalid_configuration', 'Sync dates must be valid calendar dates.');
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
const later = (a: string, b: string) => (a > b ? a : b);
const dayCount = (from: string, to: string) =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function createSyncCursor(options: {
  today: string;
  earliestHealthDate: string;
  activityFrom?: string;
  mode?: 'initial' | 'recent';
  accountId?: string | null;
  timeZone?: string;
}): GarminSyncCursor {
  if (
    !dayKey(options.today) ||
    !dayKey(options.earliestHealthDate) ||
    options.earliestHealthDate > options.today
  )
    throw new GarminError(
      'invalid_configuration',
      'The earliest Garmin-use date must be valid and no later than today.',
    );
  const cursor: GarminSyncCursor = {
    version: 1,
    mode: options.mode ?? 'initial',
    phase: 'identity',
    today: options.today,
    earliestHealthDate: options.earliestHealthDate,
    ...(options.activityFrom === undefined ? {} : { activityFrom: options.activityFrom }),
    accountId: options.accountId ?? null,
    timeZone: options.timeZone ?? 'UTC',
    activityOffset: 0,
    previousPageFingerprint: null,
    healthStreamIndex: 0,
    windowEnd: options.today,
    unavailableStreams: [],
  };
  validateCursor(cursor);
  return cursor;
}

function validateCursor(cursor: GarminSyncCursor) {
  if (
    cursor.version !== 1 ||
    !['initial', 'recent'].includes(cursor.mode) ||
    ![
      'identity',
      'recent-activities',
      'recent-health',
      'history-activities',
      'history-health',
      'done',
    ].includes(cursor.phase) ||
    !dayKey(cursor.today) ||
    !dayKey(cursor.earliestHealthDate) ||
    cursor.earliestHealthDate > cursor.today ||
    !dayKey(cursor.windowEnd) ||
    (cursor.activityFrom !== undefined &&
      (!dayKey(cursor.activityFrom) || cursor.activityFrom > cursor.today)) ||
    !Number.isInteger(cursor.activityOffset) ||
    cursor.activityOffset < 0 ||
    !Number.isInteger(cursor.healthStreamIndex) ||
    cursor.healthStreamIndex < 0 ||
    cursor.healthStreamIndex >= HEALTH_STREAMS.length ||
    !Array.isArray(cursor.unavailableStreams) ||
    cursor.unavailableStreams.some(
      (stream) => ![...HEALTH_STREAMS, 'activities'].includes(stream),
    ) ||
    (cursor.accountId !== null && !/^\d+$/.test(cursor.accountId))
  )
    throw new GarminError(
      'invalid_configuration',
      'The saved Garmin sync checkpoint is invalid or incompatible.',
    );
  try {
    new Intl.DateTimeFormat('en', { timeZone: cursor.timeZone }).format();
  } catch {
    throw new GarminError('invalid_configuration', 'The athlete timezone is invalid.');
  }
}

/** Stable coverage key for the request represented by this checkpoint, including failed attempts. */
export function requestCoverageIdentity(
  cursor: GarminSyncCursor,
): Pick<SyncCoverage, 'stream' | 'phase' | 'from' | 'to'> {
  validateCursor(cursor);
  const recentStart = addDays(cursor.today, -6);
  if (cursor.phase === 'recent-activities')
    return {
      stream: 'activities',
      phase: cursor.phase,
      from: cursor.activityFrom ? later(recentStart, cursor.activityFrom) : recentStart,
      to: cursor.today,
    };
  if (cursor.phase === 'history-activities')
    return {
      stream: 'activities',
      phase: cursor.phase,
      from: cursor.activityFrom ?? null,
      to: addDays(recentStart, -1),
    };
  if (cursor.phase === 'recent-health' || cursor.phase === 'history-health') {
    return {
      stream: HEALTH_STREAMS[cursor.healthStreamIndex],
      phase: cursor.phase,
      from: later(
        cursor.earliestHealthDate,
        cursor.phase === 'recent-health' ? recentStart : addDays(cursor.windowEnd, -27),
      ),
      to: cursor.windowEnd,
    };
  }
  return { stream: 'identity', phase: cursor.phase, from: null, to: cursor.today };
}

export function healthRequest(
  stream: HealthStream,
  from: string,
  to: string,
): { path: string; query?: GarminQuery } {
  if (!dayKey(from) || !dayKey(to) || from > to || dayCount(from, to) > 28)
    throw new GarminError(
      'invalid_configuration',
      'Health requests must cover between one and 28 calendar days.',
    );
  if (stream === 'sleep')
    return {
      path: '/sleep-service/sleep/dailySleepSummariesByDate',
      query: { startDate: from, endDate: to },
    };
  if (stream === 'daily')
    return {
      path: '/usersummary-service/v2/dailysummaries',
      query: { startDate: from, endDate: to },
    };
  if (stream === 'hrv') return { path: `/hrv-service/hrv/daily/${from}/${to}` };
  if (stream === 'bodyBattery')
    return {
      path: '/wellness-service/wellness/bodyBattery/reports/daily',
      query: { startDate: from, endDate: to },
    };
  return { path: `/usersummary-service/stats/${stream}/daily/${from}/${to}` };
}

/** Uses only stable documented numeric account identifiers; never display names or token claims. */
export async function getAccountIdentity(client: GarminReader, today: string): Promise<string> {
  if (!dayKey(today))
    throw new GarminError('invalid_configuration', 'The current Garmin calendar date is invalid.');
  try {
    const activity = await client.get('/activitylist-service/activities/search/activities', {
      start: 0,
      limit: 1,
      excludeChildren: true,
    });
    const id = assertAccountBinding(null, accountIds(activity, 'activities'));
    if (id !== null) return id;
  } catch (error) {
    if (!(error instanceof GarminError) || error.code !== 'forbidden') throw error;
  }
  for (const stream of ['daily', 'hrv'] as const) {
    const request = healthRequest(stream, addDays(today, -27), today);
    try {
      const payload = await client.get(request.path, request.query);
      const id = assertAccountBinding(null, accountIds(payload, stream));
      if (id !== null) return id;
    } catch (error) {
      if (!(error instanceof GarminError) || error.code !== 'forbidden') throw error;
    }
  }
  throw new GarminError(
    'account_identity_unavailable',
    'Garmin did not return a stable account identifier. No data was imported. Record or synchronize an activity or recent health data, then retry.',
  );
}

/** No persistence: caller must atomically commit all records, account binding and nextCursor. */
export async function runSyncStep(
  cursor: GarminSyncCursor,
  client: GarminReader,
): Promise<GarminSyncStep> {
  const coverageIdentity = requestCoverageIdentity(cursor);
  const next = { ...cursor, unavailableStreams: [...cursor.unavailableStreams] };
  const result: GarminSyncStep = {
    activities: [],
    healthRecords: [],
    nextCursor: next,
    accountId: cursor.accountId,
    coverage: {
      ...coverageIdentity,
      returnedRecords: 0,
      missingDays: 0,
      unknownMetrics: 0,
      oldestReturnedDate: null,
      status: 'available',
    },
  };
  if (cursor.phase === 'done') {
    result.coverage.status = 'complete';
    return result;
  }
  if (cursor.phase === 'identity') {
    const identity = await getAccountIdentity(client, cursor.today);
    result.accountId = next.accountId = assertAccountBinding(cursor.accountId, [identity]);
    next.phase = 'recent-activities';
    return result;
  }
  if (cursor.accountId === null)
    throw new GarminError(
      'account_identity_unavailable',
      'Garmin sync requires a verified account binding.',
    );
  const recentStart = addDays(cursor.today, -6);
  if (cursor.phase === 'recent-activities' || cursor.phase === 'history-activities') {
    const query: GarminQuery = {
      start: cursor.activityOffset,
      limit: ACTIVITY_PAGE_SIZE,
      endDate: coverageIdentity.to,
      excludeChildren: true,
      sortOrder: 'desc',
      sortBy: 'startLocal',
    };
    if (coverageIdentity.from !== null) query.startDate = coverageIdentity.from;
    let payload: unknown;
    try {
      payload = await client.get('/activitylist-service/activities/search/activities', query);
    } catch (error) {
      if (!(error instanceof GarminError) || error.code !== 'forbidden') throw error;
      next.unavailableStreams = [...new Set([...next.unavailableStreams, 'activities' as const])];
      next.phase = cursor.phase === 'recent-activities' ? 'recent-health' : 'history-health';
      next.windowEnd =
        cursor.phase === 'recent-activities' ? cursor.today : addDays(recentStart, -1);
      if (next.windowEnd < cursor.earliestHealthDate) next.phase = 'done';
      result.coverage = {
        ...result.coverage,
        stream: 'activities',
        status: 'unavailable',
        errorCode: 'forbidden',
      };
      return result;
    }
    assertAccountBinding(cursor.accountId, accountIds(payload, 'activities'));
    result.activities = normalizeActivities(payload, cursor.timeZone);
    // Advancing by actual page length tolerates provider-side page caps; only an empty page ends traversal.
    if (result.activities.length) {
      const fingerprint = createHash('sha256')
        .update(result.activities.map((a) => a.externalId).join('\0'))
        .digest('hex');
      if (fingerprint === cursor.previousPageFingerprint)
        throw new GarminError(
          'pagination_stalled',
          'Garmin repeated an activity page without advancing. Sync stopped without skipping history.',
        );
      next.activityOffset += result.activities.length;
      next.previousPageFingerprint = fingerprint;
    } else {
      next.activityOffset = 0;
      next.previousPageFingerprint = null;
      next.healthStreamIndex = 0;
      next.phase = cursor.phase === 'recent-activities' ? 'recent-health' : 'history-health';
      next.windowEnd =
        cursor.phase === 'recent-activities' ? cursor.today : addDays(recentStart, -1);
      if (next.phase === 'history-health' && next.windowEnd < cursor.earliestHealthDate)
        next.phase = 'done';
    }
    const dates = result.activities.map((a) => a.localDate).sort();
    result.coverage = {
      ...result.coverage,
      returnedRecords: result.activities.length,
      oldestReturnedDate: dates[0] ?? null,
      status: result.activities.length ? 'available' : 'no-data',
    };
    return result;
  }

  const stream = HEALTH_STREAMS[cursor.healthStreamIndex];
  const from = coverageIdentity.from!;
  const to = coverageIdentity.to;
  const request = healthRequest(stream, from, to);
  let unavailable = cursor.unavailableStreams.includes(stream);
  if (!unavailable) {
    try {
      const payload = await client.get(request.path, request.query);
      assertAccountBinding(cursor.accountId, accountIds(payload, stream));
      result.healthRecords = normalizeHealth(stream, payload);
    } catch (error) {
      if (!(error instanceof GarminError) || error.code !== 'forbidden') throw error;
      unavailable = true;
      next.unavailableStreams.push(stream);
    }
  }
  if (result.healthRecords.some((record) => record.localDate < from || record.localDate > to))
    throw new GarminError(
      'invalid_payload',
      'Garmin returned health data outside the requested calendar window.',
    );
  const dates = [...new Set(result.healthRecords.map((record) => record.localDate))].sort();
  const missingDays = dayCount(from, to) - dates.length;
  const unknownMetrics =
    result.healthRecords.filter((record) => record.value === null).length +
    missingDays * streamMetrics[stream].length;
  result.coverage = {
    stream,
    phase: cursor.phase,
    from,
    to,
    returnedRecords: result.healthRecords.length,
    missingDays,
    unknownMetrics,
    oldestReturnedDate: dates[0] ?? null,
    status: unavailable
      ? 'unavailable'
      : dates.length === 0
        ? 'no-data'
        : unknownMetrics
          ? 'partial'
          : 'available',
    ...(unavailable ? { errorCode: 'forbidden' as const } : {}),
  };
  next.healthStreamIndex++;
  if (next.healthStreamIndex === HEALTH_STREAMS.length) {
    next.healthStreamIndex = 0;
    if (cursor.phase === 'recent-health') {
      next.phase = cursor.mode === 'initial' ? 'history-activities' : 'done';
      if (
        next.phase === 'history-activities' &&
        (next.unavailableStreams.includes('activities') ||
          (cursor.activityFrom !== undefined && cursor.activityFrom >= recentStart))
      ) {
        next.phase = 'history-health';
        next.windowEnd = addDays(recentStart, -1);
        if (next.windowEnd < cursor.earliestHealthDate) next.phase = 'done';
      }
    } else {
      next.windowEnd = addDays(from, -1);
      if (next.windowEnd < cursor.earliestHealthDate) next.phase = 'done';
    }
  }
  return result;
}
