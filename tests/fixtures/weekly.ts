import { workoutSchema } from '@athlete-panel/contracts';
import { calendarFixture, calendarId as id, health } from './calendar';

export function weeklyFixture() {
  const data = calendarFixture();
  data.notes = []; data.events = []; data.injuries = [];
  data.activities = [
    { ...data.activities[0]!, durationSeconds: 5400, distanceMeters: 50000, elevationMeters: 500 },
    { ...data.activities[1]!, startedAt: '2030-01-08T23:30:00Z', localDate: '2030-01-09', durationSeconds: 3600, distanceMeters: 10000, elevationMeters: 100 },
    { ...data.activities[2]!, durationSeconds: 3600 },
  ];
  data.workouts = [
    { ...data.workouts[0]!, durationSeconds: 7200, distanceMeters: 60000 },
    workoutSchema.parse({ id: id(100), revision: 1, title: 'Short easy run', sport: 'running', schedule: { kind: 'independent', date: '2030-01-08' }, durationSeconds: 3600, distanceMeters: 10000, completion: { source: 'manual', activityId: null, status: 'partial', performedDate: '2030-01-08', durationSeconds: 1800, distanceMeters: 5000, reason: 'Short on time' } }),
    workoutSchema.parse({ id: id(101), revision: 1, title: 'Skipped run', sport: 'running', schedule: { kind: 'independent', date: '2030-01-09' }, durationSeconds: 3600, distanceMeters: 10000, completion: { source: 'manual', activityId: null, status: 'skipped', performedDate: '2030-01-09' } }),
    workoutSchema.parse({ id: id(102), revision: 1, title: 'Pending ride', sport: 'cycling', schedule: { kind: 'independent', date: '2030-01-10' }, durationSeconds: 3600, distanceMeters: 30000 }),
  ];
  data.health = [health(200, '2030-01-07', 'sleepDurationSeconds', 28800), health(201, '2030-01-08', 'sleepDurationSeconds', 21600), health(202, '2030-01-09', 'sleepScore', 80), health(204, '2030-01-09', 'hrvMilliseconds', 54)];
  return data;
}
