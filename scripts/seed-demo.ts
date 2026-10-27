import { randomUUID } from 'node:crypto';
import { closeDatabase, transaction } from '../packages/host/src/db';
import { initialOnboarding, writeOnboarding } from '../packages/host/src/onboarding';
import { bootstrapOwner } from '../packages/host/src/auth';
import { mutate } from '../plugins/training/service';
import { activitySchema, healthRecordSchema } from '../packages/contracts/src';
import { recordsRepository } from '../plugins/activity-records/repository';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test') ||
  process.env.ATHLETE_PANEL_DEMO !== 'true'
)
  throw new Error(
    'Demo seeding requires ATHLETE_PANEL_DEMO=true and an isolated local *_test database.',
  );
const date = new Date().toISOString().slice(0, 10);
const base = new Date(date + 'T00:00:00Z');
base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
const day = (offset: number) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
try {
  await bootstrapOwner(process.env.DEMO_PASSWORD ?? 'AthletePanel-demo-only-2026');
  await transaction((tx) => writeOnboarding(tx, initialOnboarding('existing-owner')));
  const planId = randomUUID();
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'profile.set',
        expectedRevision: null,
        values: {
          displayName: 'Alex Morgan',
          timezone: 'Europe/Paris',
          units: 'metric',
          goals: 'Build consistent cycling volume and prepare for a spring 10 km.',
          ftpWatts: 245,
          weeklyAvailability: {
            monday: 3600,
            tuesday: 5400,
            wednesday: 3600,
            thursday: 5400,
            friday: 1800,
            saturday: 10800,
            sunday: 7200,
          },
          heartRateZones: { cycling: [120, 140, 155, 170], running: [125, 145, 160, 178] },
        },
      },
      {
        action: 'plan.create',
        values: {
          id: planId,
          title: 'Build a steady foundation',
          description: 'Three weeks of aerobic consistency.',
          startDate: day(0),
        },
      },
      ...Array.from({ length: 3 }, (_, week) =>
        [0, 1, 3, 5, 6].map((d, index) => ({
          action: 'workout.create',
          values: {
            title: [
              'Easy miles',
              'Threshold intervals',
              'Easy run',
              'Long endurance ride',
              'Recovery spin',
            ][index],
            sport: index === 2 ? 'running' : 'cycling',
            schedule: { kind: 'plan', planId, day: week * 7 + d + 1 },
            durationSeconds: [2700, 4500, 2400, 9000, 3000][index],
            distanceMeters: null,
            order: 1,
            notes:
              index === 1
                ? 'Keep the efforts controlled. Finish feeling you could do one more.'
                : '',
            steps:
              index === 1
                ? [
                    { kind: 'warmup', durationSeconds: 900, distanceMeters: null, target: null },
                    {
                      kind: 'repeat',
                      times: 3,
                      steps: [
                        {
                          kind: 'work',
                          durationSeconds: 600,
                          distanceMeters: null,
                          target: { kind: 'powerWatts', min: 220, max: 245 },
                        },
                        {
                          kind: 'recovery',
                          durationSeconds: 300,
                          distanceMeters: null,
                          target: null,
                        },
                      ],
                    },
                    { kind: 'cooldown', durationSeconds: 900, distanceMeters: null, target: null },
                  ]
                : [],
          },
        })),
      ).flat(),
      {
        action: 'event.create',
        values: {
          title: 'Autumn 10 km',
          date: day(20),
          kind: 'race',
          notes: 'Run with friends; focus on an even pace.',
        },
      },
      {
        action: 'note.create',
        values: {
          title: 'Keep it sustainable',
          body: 'Consistency first. Protect the easy days.',
          schedule: { kind: 'independent', date: day(2) },
        },
      },
    ],
  });
  await transaction(async (tx) => {
    for (let i = -21; i <= 0; i++) {
      for (const [metric, value] of [
        ['sleepDurationSeconds', 25200 + ((i + 21) % 5) * 1200],
        ['sleepScore', 75 + ((i + 21) % 8)],
        ['restingHeartRateBpm', 49 + ((i + 21) % 4)],
        ['hrvMilliseconds', 53 + ((i + 21) % 7)],
        ['steps', 6500 + ((i + 21) % 6) * 700],
        ['stress', 28 + ((i + 21) % 7)],
        ['bodyBattery', 62 + ((i + 21) % 10)],
      ] as const) {
        const record = healthRecordSchema.parse({
          id: randomUUID(),
          revision: 1,
          provider: 'garmin',
          externalId: `synthetic:${metric}:${day(i)}`,
          metric,
          localDate: day(i),
          measuredAt: null,
          value,
        });
        await recordsRepository.save('health', record, tx);
      }
      if (i % 3 === 0) {
        const record = activitySchema.parse({
          id: randomUUID(),
          revision: 1,
          provider: 'garmin',
          externalId: `synthetic:activity:${day(i)}`,
          title: i % 2 ? 'River path run' : 'Morning endurance ride',
          sport: i % 2 ? 'running' : 'cycling',
          startedAt: day(i) + 'T07:00:00Z',
          localDate: day(i),
          dateSource: 'provider',
          durationSeconds: i % 2 ? 2800 : 5400,
          distanceMeters: i % 2 ? 8200 : 42000,
          elevationMeters: 180,
          averageHeartRateBpm: 137,
        });
        await recordsRepository.save('activity', record, tx);
      }
    }
  });
  console.log(
    'Synthetic demo workspace created. Password is the supplied DEMO_PASSWORD or documented demo default.',
  );
} finally {
  await closeDatabase();
}
