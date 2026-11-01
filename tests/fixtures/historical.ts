import {
  activitySchema,
  healthRecordSchema,
  workoutSchema,
  profileSchema,
  healthMetricSchema,
} from '../../packages/contracts/src';
import { addDays } from '../../plugins/training/dates';
import type { Transaction } from '../../packages/host/src/db';
export const historyId = (n: number) =>
  `91000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const historicalRange = { from: '2021-10-31', to: '2026-10-31' };
export function syntheticDay(date: string, day: number) {
  const activities = Array.from({ length: 3 }, (_, sportIndex) =>
    activitySchema.parse({
      id: historyId(day * 3 + sportIndex + 1),
      revision: 1,
      provider: 'garmin',
      externalId: `synthetic:${day}:${sportIndex}`,
      title: `Synthetic ${['run', 'ride', 'strength'][sportIndex]}`,
      sport: ['running', 'cycling', 'fitness_equipment'][sportIndex],
      startedAt: `${date}T08:00:00Z`,
      localDate: date,
      dateSource: 'provider',
      durationSeconds: 1800 + sportIndex * 900,
      distanceMeters: sportIndex === 2 ? null : 5000 + sportIndex * 15000,
      elevationMeters: day % 11 === 0 ? null : 100,
      averageHeartRateBpm: 130,
      provenance: { sourceAccountId: 'synthetic-a', source: 'activities' },
    }),
  );
  const health = healthMetricSchema.options.map((metric, index) =>
    healthRecordSchema.parse({
      id: historyId(100000 + day * 20 + index),
      revision: 1,
      provider: 'garmin',
      externalId: `synthetic:${date}:${metric}`,
      localDate: date,
      measuredAt: null,
      metric,
      value:
        day % 13 === 0
          ? null
          : metric === 'sleepDurationSeconds'
            ? 28800
            : metric === 'steps'
              ? 8000
              : metric.endsWith('Seconds')
                ? 3600
                : 55,
      provenance: {
        sourceAccountId: 'synthetic-a',
        source: metric.startsWith('sleep')
          ? 'sleep'
          : metric === 'hrvMilliseconds'
            ? 'hrv'
            : 'daily',
        ...(metric === 'restingHeartRateBpm' ? { restingHeartRateMayBeMinimum: true } : {}),
      },
    }),
  );
  const workouts = activities.map((a, index) =>
    workoutSchema.parse({
      id: historyId(300000 + day * 3 + index),
      revision: 1,
      title: `Synthetic planned ${a.title}`,
      sport: a.sport,
      order: index + 1,
      schedule: { kind: 'plan', planId: historyId(900000), day: day + 1 },
      durationSeconds: 3600,
      distanceMeters: a.distanceMeters,
      notes: 'PRIVATE_WORKOUT_NOTE',
      steps: [],
      completion:
        index === 0
          ? {
              status: 'completed',
              source: 'garmin',
              activityId: a.id,
              performedDate: date,
              durationSeconds: a.durationSeconds,
              distanceMeters: a.distanceMeters,
              reason: '',
              notes: 'PRIVATE_COMPLETION_NOTE',
            }
          : index === 1
            ? {
                status: 'completed',
                source: 'manual',
                activityId: null,
                performedDate: date,
                durationSeconds: 2700,
                distanceMeters: 15000,
                reason: '',
                notes: 'PRIVATE_COMPLETION_NOTE',
              }
            : null,
    }),
  );
  return { activities, health, workouts };
}
/** Synthetic-only callers enforce the loopback _test database guard before passing a transaction. */
export async function seedHistoricalDataset(tx: Transaction, minimumRecords = 30000) {
  await tx`insert into athlete.records(kind,id,revision,data) values('profile','owner',1,${tx.json(profileSchema.parse({ id: 'owner', revision: 1, goals: 'Synthetic long-term goal', weekStartsOnPreference: 'monday' }))})`;
  await tx`insert into training.records(kind,id,revision,data) values('plan',${historyId(900000)},1,${tx.json({ id: historyId(900000), revision: 1, title: 'Synthetic five-year schedule', startDate: historicalRange.from, description: 'PRIVATE_PLAN_NOTE' })})`;
  let day = 0,
    activityCount = 0,
    healthCount = 0,
    workoutCount = 0;
  for (
    let date = historicalRange.from;
    date <= historicalRange.to;
    date = addDays(date, 1), day++
  ) {
    const batch = syntheticDay(date, day);
    // Recurring same-source null corrections and overlapping accounts exercise real daily precedence.
    const additionalHealth =
      day % 30 === 0
        ? [
            healthRecordSchema.parse({
              ...batch.health.find((record) => record.metric === 'restingHeartRateBpm')!,
              id: historyId(700000 + day * 2),
              revision: 2,
              externalId: `synthetic-correction:${date}`,
              value: null,
            }),
            healthRecordSchema.parse({
              ...batch.health.find((record) => record.metric === 'restingHeartRateBpm')!,
              id: historyId(700001 + day * 2),
              externalId: `synthetic-second-account:${date}`,
              value: 58,
              provenance: { sourceAccountId: 'synthetic-b', source: 'daily' },
            }),
          ]
        : [];
    batch.health.push(...additionalHealth);
    const imported = [
      ...batch.activities.map((data) => ({ kind: 'activity', id: data.id, revision: 1, data })),
      ...batch.health.map((data) => ({ kind: 'health', id: data.id, revision: 1, data })),
    ];
    await tx`insert into activity_records.records ${tx(imported, 'kind', 'id', 'revision', 'data')}`;
    // Remove optional modern fields on older rows: historical readers must retain unknowns.
    const training = batch.workouts.map((data) => ({
      kind: 'workout',
      id: data.id,
      revision: 1,
      data:
        day < 365
          ? Object.fromEntries(
              Object.entries(data).filter(
                ([k]) =>
                  !['kind', 'sportSubgroup', 'plannedElevationGainMeters', 'exercises'].includes(k),
              ),
            )
          : data,
    }));
    await tx`insert into training.records ${tx(training, 'kind', 'id', 'revision', 'data')}`;
    activityCount += batch.activities.length;
    healthCount += batch.health.length;
    workoutCount += batch.workouts.length;
  }
  let total = activityCount + healthCount + workoutCount + 2;
  for (let offset = 0; total < minimumRecords;) {
    const count = Math.min(1000, minimumRecords - total),
      rows = [];
    for (let i = 0; i < count; i++, offset++) {
      const date = addDays(historicalRange.from, offset % day),
        original = syntheticDay(date, offset % day).activities[offset % 3]!;
      const data = {
        ...original,
        id: historyId(1000000 + offset),
        externalId: `synthetic-stress:${offset}`,
      };
      rows.push({ kind: 'activity', id: data.id, revision: 1, data });
    }
    await tx`insert into activity_records.records ${tx(rows, 'kind', 'id', 'revision', 'data')}`;
    activityCount += count;
    total += count;
  }
  for (const stream of ['activities', 'sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery']) {
    await tx`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,scanned_at) values(${stream},'2021-10-31','2024-01-31','partial','scanned',now()),(${stream},'2024-01-01','2025-12-31','partial','scanned',now()),(${stream},'2026-01-01','2026-06-30','failed','failed',null),(${stream},'2026-07-01','2026-09-30','unavailable','unavailable',null)`;
  }
  return {
    days: day,
    activities: activityCount,
    health: healthCount,
    workouts: workoutCount,
    plans: 1,
    profiles: 1,
    coverageWindows: 28,
    total: total + 28,
  };
}
