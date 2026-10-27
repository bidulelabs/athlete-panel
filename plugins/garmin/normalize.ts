import type { Activity, HealthRecord } from '@athlete-panel/contracts';
import { GarminError } from './transport';

export type ImportedActivity = Omit<Activity, 'id' | 'revision'>;
export type ImportedHealthRecord = Omit<HealthRecord, 'id' | 'revision'>;
export const HEALTH_STREAMS = ['sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery'] as const;
export type HealthStream = (typeof HEALTH_STREAMS)[number];
type Row = Record<string, unknown>;

export const streamMetrics: Record<HealthStream, HealthRecord['metric'][]> = {
  sleep: [
    'sleepDurationSeconds',
    'sleepDeepSeconds',
    'sleepLightSeconds',
    'sleepRemSeconds',
    'sleepAwakeSeconds',
    'sleepScore',
  ],
  daily: ['restingHeartRateBpm'],
  hrv: ['hrvMilliseconds'],
  steps: ['steps'],
  stress: ['stress'],
  bodyBattery: ['bodyBattery'],
};

export function object(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}
export function providerId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new GarminError(
    'invalid_payload',
    'Garmin returned an invalid or unsafe numeric identifier.',
  );
}
export function knownNumber(value: unknown, maximum = Number.MAX_VALUE): number | null {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean')
    return null;
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)))
    return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= maximum ? result : null;
}
export function dayKey(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function utcTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null;
  if (!dayKey(value.slice(0, 10))) return null;
  const iso = value.replace(' ', 'T');
  const result = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(result) ? new Date(result).toISOString() : null;
}
export function dateInTimezone(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso));
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch {
    throw new GarminError('invalid_configuration', 'The athlete timezone is invalid.');
  }
}
function array(value: unknown): Row[] {
  if (value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))
  ) {
    throw new GarminError('invalid_payload', 'Garmin returned an unexpected record collection.');
  }
  return value as Row[];
}
/** Validate the envelope separately so malformed individual rows can be diagnosed. */
export function rawRows(stream: HealthStream | 'activities', payload: unknown): unknown[] {
  if (payload === null) return [];
  const value =
    stream === 'daily'
      ? object(payload).data
      : stream === 'hrv'
        ? object(payload).hrvSummaries
        : payload;
  if (!Array.isArray(value))
    throw new GarminError('invalid_payload', 'Garmin returned an unexpected record collection.');
  return value;
}
export function rowsForStream(stream: HealthStream, payload: unknown): Row[] {
  if (payload === null) return [];
  if (stream === 'daily') return array(object(payload).data);
  if (stream === 'hrv') return array(object(payload).hrvSummaries);
  return array(payload);
}
export function accountIds(payload: unknown, stream: HealthStream | 'activities'): string[] {
  const rows = rawRows(stream, payload);
  const ids: string[] = [];
  const inspect = (row: Row, keys: string[]) => {
    for (const key of keys) {
      const id = providerId(row[key]);
      if (id !== null) ids.push(id);
    }
  };
  if (stream === 'hrv') inspect(object(payload), ['userProfilePk', 'userProfilePK']);
  for (const raw of rows)
    inspect(
      object(raw),
      stream === 'activities' ? ['ownerId'] : ['userProfilePk', 'userProfilePK'],
    );
  return [...new Set(ids)];
}
export function assertAccountBinding(expected: string | null, ids: string[]): string | null {
  if (ids.length > 1 || (expected !== null && ids.some((id) => id !== expected))) {
    throw new GarminError(
      'account_mismatch',
      'This Garmin key belongs to a different account. Imported accounts cannot be merged.',
    );
  }
  return expected ?? ids[0] ?? null;
}

export function normalizeActivities(payload: unknown, timeZone = 'UTC'): ImportedActivity[] {
  return array(payload).map((row) => {
    const externalId = providerId(row.activityId);
    const startedAt = utcTimestamp(row.startTimeGMT);
    if (externalId === null || startedAt === null)
      throw new GarminError(
        'invalid_payload',
        'A Garmin activity is missing its identifier or UTC start time.',
      );
    const local =
      typeof row.startTimeLocal === 'string' ? dayKey(row.startTimeLocal.slice(0, 10)) : null;
    const type = String(object(row.activityType).typeKey ?? '').toLowerCase();
    const sport: Activity['sport'] = /cycling|biking|bike|virtual_ride/.test(type)
      ? 'cycling'
      : /running|treadmill|trail_run|track_run|virtual_run/.test(type)
        ? 'running'
        : 'other';
    return {
      provider: 'garmin',
      externalId,
      title:
        typeof row.activityName === 'string' && row.activityName.trim()
          ? row.activityName.trim().slice(0, 300)
          : 'Garmin activity',
      sport,
      startedAt,
      localDate: local ?? dateInTimezone(startedAt, timeZone),
      dateSource: local ? 'provider' : 'inferred',
      durationSeconds: knownNumber(row.duration),
      distanceMeters: knownNumber(row.distance),
      elevationMeters: knownNumber(row.elevationGain),
      averageHeartRateBpm: knownNumber(row.averageHR),
    };
  });
}

function latestBodyBattery(row: Row): { value: number | null; measuredAt: string | null } {
  const descriptors = Array.isArray(row.bodyBatteryValueDescriptorDTOList)
    ? row.bodyBatteryValueDescriptorDTOList.map(object)
    : [];
  const index = (key: string) =>
    descriptors.find((d) => d.bodyBatteryValueDescriptorKey === key)
      ?.bodyBatteryValueDescriptorIndex;
  const timeIndex = index('timestamp');
  const valueIndex = index('bodyBatteryLevel');
  if (
    typeof timeIndex !== 'number' ||
    !Number.isInteger(timeIndex) ||
    timeIndex < 0 ||
    typeof valueIndex !== 'number' ||
    !Number.isInteger(valueIndex) ||
    valueIndex < 0
  )
    return { value: null, measuredAt: null };
  const values = Array.isArray(row.bodyBatteryValuesArray) ? row.bodyBatteryValuesArray : [];
  let latest: { order: number; value: number; measuredAt: string | null } | null = null;
  for (const reading of values) {
    if (!Array.isArray(reading)) continue;
    const value = knownNumber(reading[valueIndex], 100);
    const rawTime: unknown = reading[timeIndex];
    const measuredAt = utcTimestamp(rawTime);
    // Numeric descriptor timestamps have no unit specified in the published schema.
    // Their order is usable, but do not fabricate an instant by guessing seconds/ms.
    const order =
      typeof rawTime === 'number' && Number.isFinite(rawTime)
        ? rawTime
        : measuredAt
          ? Date.parse(measuredAt)
          : null;
    if (value !== null && order !== null && (!latest || order > latest.order))
      latest = { order, value, measuredAt };
  }
  return latest
    ? { value: latest.value, measuredAt: latest.measuredAt }
    : { value: null, measuredAt: null };
}

const emptySleepMetadata = new Set([
  'deviceRemCapable',
  'retro',
  'sleepNeed',
  'nextSleepNeed',
  'napTimeSeconds',
  'dailyNapDTOS',
]);
function isUndatedEmptySleep(row: Row): boolean {
  // Personal API history can include empty overnight DTOs alongside sleep-need
  // or nap metadata. They have no date to import and no overnight observation.
  // Require the explicit empty DTO shape; never hide an undated actual sleep.
  return (
    row.calendarDate === null &&
    row.id === null &&
    row.sleepTimeSeconds === null &&
    row.sleepStartTimestampGMT === null &&
    row.sleepEndTimestampGMT === null &&
    Object.entries(row).every(
      ([field, value]) => value === null || value === undefined || emptySleepMetadata.has(field),
    )
  );
}

export function normalizeHealth(stream: HealthStream, payload: unknown): ImportedHealthRecord[] {
  const output = new Map<string, ImportedHealthRecord>();
  for (const row of rowsForStream(stream, payload)) {
    if (stream === 'sleep' && isUndatedEmptySleep(row)) continue;
    const localDate = dayKey(stream === 'bodyBattery' ? row.date : row.calendarDate);
    if (localDate === null)
      throw new GarminError(
        'invalid_payload',
        `A Garmin ${stream} record has a missing or invalid calendar date.`,
      );
    const emit = (
      metric: HealthRecord['metric'],
      value: unknown,
      maximum?: number,
      measuredAt: string | null = null,
    ) => {
      const externalId = `${stream}:${localDate}:${metric}`;
      output.set(externalId, {
        provider: 'garmin',
        externalId,
        metric,
        localDate,
        measuredAt,
        value: knownNumber(value, maximum),
      });
    };
    if (stream === 'sleep') {
      const measuredAt = utcTimestamp(row.sleepEndTimestampGMT);
      emit('sleepDurationSeconds', row.sleepTimeSeconds, undefined, measuredAt);
      emit('sleepDeepSeconds', row.deepSleepSeconds, undefined, measuredAt);
      emit('sleepLightSeconds', row.lightSleepSeconds, undefined, measuredAt);
      emit('sleepRemSeconds', row.remSleepSeconds, undefined, measuredAt);
      emit('sleepAwakeSeconds', row.awakeSleepSeconds, undefined, measuredAt);
      emit('sleepScore', object(object(row.sleepScores).overall).value, 100, measuredAt);
    } else if (stream === 'daily') emit('restingHeartRateBpm', object(row.heartRate).restingValue);
    else if (stream === 'hrv') emit('hrvMilliseconds', row.lastNightAvg);
    else if (stream === 'steps') emit('steps', row.totalSteps);
    else if (stream === 'stress') emit('stress', object(row.values).overallStressLevel, 100);
    else {
      const latest = latestBodyBattery(row);
      emit('bodyBattery', latest.value, 100, latest.measuredAt);
    }
  }
  return [...output.values()];
}
