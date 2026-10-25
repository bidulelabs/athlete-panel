import { activitySchema, emptyWorkspace, healthRecordSchema, injurySchema, noteSchema, eventSchema, planSchema, profileSchema, workoutSchema, type HealthRecord } from '@athlete-panel/contracts';

export const calendarId = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export function health(value: number, date: string, metric: HealthRecord['metric'], measurement: number | null, account: string | null = 'synthetic-account'): HealthRecord {
  return healthRecordSchema.parse({ id: calendarId(value), revision: 1, provider: 'garmin', externalId: `${account}:${date}:${metric}`, localDate: date, metric, value: measurement, measuredAt: `${date}T07:00:00Z`, ...(account === null ? {} : { provenance: { sourceAccountId: account, source: metric === 'hrvMilliseconds' ? 'hrv' : 'sleep' } }) });
}

export function calendarFixture() {
  const data = emptyWorkspace();
  data.profile = profileSchema.parse({ id: 'owner', revision: 1, displayName: 'Alex Morgan', timezone: 'Europe/Paris', weekStartsOnPreference: 'monday' });
  data.plans = [planSchema.parse({ id: calendarId(1), revision: 1, title: 'Winter base', startDate: '2030-01-07' })];
  data.workouts = [workoutSchema.parse({ id: calendarId(2), revision: 1, title: 'Steady endurance ride', sport: 'cycling', schedule: { kind: 'plan', planId: calendarId(1), day: 1 }, durationSeconds: 3600, completion: { status: 'completed', source: 'garmin', activityId: calendarId(3), performedDate: '2030-01-07', durationSeconds: 3720, distanceMeters: 30000 } })];
  data.activities = [
    activitySchema.parse({ id: calendarId(3), revision: 1, provider: 'garmin', externalId: 'synthetic-linked', title: 'Morning ride', sport: 'cycling', startedAt: '2030-01-07T08:00:00Z', localDate: '2030-01-07', dateSource: 'provider', durationSeconds: 3720, distanceMeters: 30000, elevationMeters: 250, averageHeartRateBpm: 128 }),
    activitySchema.parse({ id: calendarId(4), revision: 1, provider: 'garmin', externalId: 'synthetic-run', title: 'River path run', sport: 'running', startedAt: '2030-01-05T23:30:00Z', localDate: '2030-01-06', dateSource: 'provider', durationSeconds: 2700, distanceMeters: 8000, elevationMeters: 0, averageHeartRateBpm: null }),
    activitySchema.parse({ id: calendarId(5), revision: 1, provider: 'garmin', externalId: 'synthetic-other', title: 'Mobility session', sport: 'other', startedAt: '2030-01-09T07:00:00Z', localDate: '2030-01-09', dateSource: 'provider', durationSeconds: 0, distanceMeters: null, elevationMeters: null, averageHeartRateBpm: null }),
  ];
  data.notes = [
    noteSchema.parse({ id: calendarId(6), revision: 1, title: 'Travel day', body: 'Early train to the coast.\n\nKeep the afternoon free and the session easy. <b>Plain text stays plain.</b>', schedule: { kind: 'independent', date: '2030-01-06' } }),
    noteSchema.parse({ id: calendarId(7), revision: 1, title: 'Protect the easy day', body: 'An easy spin, then a long lunch.\nListen to how your legs feel.', schedule: { kind: 'plan', planId: calendarId(1), day: 2 } }),
  ];
  data.events = [eventSchema.parse({ id: calendarId(8), revision: 1, title: 'Coastal 10 km', date: '2030-01-07', kind: 'race', notes: 'Meet at the lighthouse.\nBring a warm layer for after the finish.' })];
  data.injuries = [
    injurySchema.parse({ id: calendarId(9), revision: 1, bodyPart: 'Left knee', description: 'Keep impact low while symptoms settle.', startDate: '2030-01-05', endDate: '2030-01-08', severity: 'moderate', notes: 'Stop if pain increases.' }),
    injurySchema.parse({ id: calendarId(10), revision: 1, bodyPart: 'Right shoulder', description: 'Avoid heavy lifting.', startDate: '2030-01-09', endDate: null, severity: 'mild' }),
  ];
  data.health = [
    health(20, '2030-01-06', 'sleepDurationSeconds', 28800), health(21, '2030-01-06', 'sleepScore', 87), health(22, '2030-01-06', 'hrvMilliseconds', 58),
    health(23, '2030-01-06', 'sleepDeepSeconds', 5400), health(24, '2030-01-06', 'sleepLightSeconds', 18000), health(25, '2030-01-06', 'sleepRemSeconds', 5400), health(26, '2030-01-06', 'sleepAwakeSeconds', 1800),
    health(30, '2030-01-07', 'sleepDurationSeconds', 25200), health(31, '2030-01-07', 'sleepDeepSeconds', 0), health(32, '2030-01-07', 'sleepScore', 81),
    health(40, '2030-01-08', 'sleepScore', 0), health(41, '2030-01-09', 'sleepDurationSeconds', null),
  ];
  return data;
}
