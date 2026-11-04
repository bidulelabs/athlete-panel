import {
  activitySchema,
  emptyWorkspace,
  eventSchema,
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
