import {
  activitySchema,
  emptyWorkspace,
  eventSchema,
  healthRecordSchema,
  profileSchema,
  workoutSchema,
} from '@athlete-panel/contracts';
import { addDays } from '../../plugins/training/dates';

export const chartsId = (value: number) =>
  `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const chartsToday = '2030-01-16';
export const chartsFirstWeek = '2029-10-22';
const recordedMinutes = [300, 360, 0, 420, 390, 480, 270, 450, 510, 300, null, 120];
const plannedMinutes = [330, 360, 360, 420, 420, 480, 300, 480, 540, 330, 360, 420];

export function activity(id: number, localDate: string, durationSeconds: number | null) {
  return activitySchema.parse({
    id: chartsId(id),
    revision: 1,
    provider: 'garmin',
    externalId: `synthetic-charts-${id}`,
    title: 'Synthetic run',
    sport: 'running',
    startedAt: `${localDate}T07:00:00Z`,
    localDate,
    dateSource: 'provider',
    durationSeconds,
    distanceMeters: null,
    elevationMeters: null,
    averageHeartRateBpm: null,
  });
}
export function plannedWorkout(id: number, date: string, durationSeconds: number) {
  return workoutSchema.parse({
    id: chartsId(id),
    revision: 1,
    title: 'Synthetic planned session',
    sport: 'running',
    schedule: { kind: 'independent', date },
    durationSeconds,
  });
}
export function trainingEvent(id: number, date: string, title: string, kind = 'race') {
  return eventSchema.parse({ id: chartsId(id), revision: 1, title, date, kind });
}

export function chartsWorkspace() {
  const data = emptyWorkspace();
  data.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex Morgan',
    timezone: 'Europe/Paris',
    weekStartsOnPreference: 'monday',
  });
  recordedMinutes.forEach((minutes, week) => {
    const monday = addDays(chartsFirstWeek, week * 7);
    data.workouts.push(
      plannedWorkout(100 + week * 2, addDays(monday, 1), plannedMinutes[week]! * 30),
      plannedWorkout(101 + week * 2, addDays(monday, 5), plannedMinutes[week]! * 30),
    );
    if (minutes === 0) return;
    data.activities.push(
      activity(200 + week * 2, addDays(monday, 1), minutes === null ? null : minutes * 30),
      activity(201 + week * 2, addDays(monday, 5), minutes === null ? 1800 : minutes * 30),
    );
  });
  data.events = [
    trainingEvent(300, '2029-11-30', 'Hill 15 km'),
    trainingEvent(301, '2029-12-31', 'New Year 10 km'),
    trainingEvent(302, '2029-12-10', 'Club dinner', 'other'),
  ];
  return data;
}

const sportRotation = ['running', 'cycling', 'running', 'hiking'];
export function mixedSportsWorkspace() {
  const data = chartsWorkspace();
  data.activities = data.activities.map((item, index) =>
    activitySchema.parse({
      ...item,
      sport:
        index === 6
          ? 'swimming'
          : index === 15
            ? 'winter_sports'
            : index === 9
              ? 'paragliding'
              : sportRotation[index % sportRotation.length],
      sportResolution: index === 9 ? 'unresolved' : 'resolved',
    }),
  );
  return data;
}

const metersPerSecondBySport: Record<string, number> = { running: 2.8, cycling: 7, hiking: 1.2 };
const climbMetersPerHourBySport: Record<string, number> = {
  running: 150,
  cycling: 400,
  hiking: 300,
  winter_sports: 500,
};
const averageHeartRateBySport: Record<string, number> = {
  running: 145,
  cycling: 128,
  hiking: 112,
  winter_sports: 135,
  swimming: 120,
};
export function elevationAndHeartRateWorkspace() {
  const data = mixedSportsWorkspace();
  data.activities = data.activities.map((item, index) =>
    activitySchema.parse({
      ...item,
      distanceMeters:
        item.durationSeconds === null
          ? null
          : Math.round(item.durationSeconds * (metersPerSecondBySport[item.sport] ?? 1)),
      elevationMeters:
        index === 4 || item.durationSeconds === null || !(item.sport in climbMetersPerHourBySport)
          ? null
          : Math.round(
              (item.durationSeconds / 3600) *
                climbMetersPerHourBySport[item.sport]! *
                (1 + (index % 3) / 2),
            ),
      averageHeartRateBpm:
        index === 2 || !(item.sport in averageHeartRateBySport)
          ? null
          : averageHeartRateBySport[item.sport]! + (index % 5) * 2,
    }),
  );
  return data;
}

export function nightRecord(
  id: number,
  localDate: string,
  metric: 'restingHeartRateBpm' | 'hrvMilliseconds',
  value: number | null,
  restingHeartRateMayBeMinimum = false,
) {
  return healthRecordSchema.parse({
    id: chartsId(id),
    revision: 1,
    provider: 'garmin',
    externalId: `synthetic-night-${id}`,
    metric,
    localDate,
    measuredAt: null,
    value,
    provenance: { sourceAccountId: 'synthetic', source: 'garmin', restingHeartRateMayBeMinimum },
  });
}

export function nightsWorkspace() {
  const data = chartsWorkspace();
  const firstNight = addDays(chartsFirstWeek, -60);
  for (let day = 0; addDays(firstNight, day) <= chartsToday; day++) {
    if (day % 9 === 4) continue;
    const date = addDays(firstNight, day);
    const illness = date >= '2029-12-18' && date <= '2029-12-23';
    data.health.push(
      nightRecord(
        1000 + day * 2,
        date,
        'hrvMilliseconds',
        58 + ((day * 7) % 11) - 5 - (illness ? 14 : 0),
      ),
      nightRecord(
        1001 + day * 2,
        date,
        'restingHeartRateBpm',
        47 + ((day * 3) % 4) + (illness ? 6 : 0),
        day % 5 === 0,
      ),
    );
  }
  return data;
}

export function trainingLoadWorkspace() {
  const data = chartsWorkspace();
  data.profile = profileSchema.parse({
    ...data.profile,
    restingHeartRateBpm: 47,
    maxHeartRateBpm: 196,
  });
  data.activities = [];
  const firstDay = addDays(chartsFirstWeek, -48);
  for (let day = 0; addDays(firstDay, day) <= chartsToday; day++) {
    const date = addDays(firstDay, day);
    const restDay = day % 7 === 3 || (date >= '2029-12-18' && date <= '2029-12-24');
    if (restDay) continue;
    const longDay = day % 7 === 5;
    data.activities.push(
      activitySchema.parse({
        ...activity(6000 + day, date, (longDay ? 110 : 40 + (day % 4) * 12) * 60),
        averageHeartRateBpm: day % 17 === 8 ? null : 126 + (day % 5) * 7 + (longDay ? 4 : 0),
      }),
    );
  }
  return data;
}
