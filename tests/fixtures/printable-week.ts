import {
  emptyWorkspace,
  planSchema,
  profileSchema,
  workoutSchema,
  type Workout,
} from '@athlete-panel/contracts';
import { calendarId } from './calendar';

export function printableWeekFixture() {
  const state = emptyWorkspace();
  state.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex (synthetic)',
    weekStartsOnPreference: 'monday',
    timezone: 'Europe/Paris',
  });
  state.plans = [
    planSchema.parse({
      id: calendarId(1),
      revision: 1,
      title: 'Winter base',
      startDate: '2030-01-07',
    }),
    planSchema.parse({
      id: calendarId(2),
      revision: 1,
      title: 'Unscheduled plan',
      startDate: null,
    }),
  ];
  const workout = (id: number, values: Partial<Workout>) =>
    workoutSchema.parse({
      id: calendarId(id),
      revision: 1,
      title: 'Session',
      sport: 'running',
      schedule: { kind: 'plan', planId: calendarId(1), day: 1 },
      ...values,
    });
  state.workouts = [
    workout(10, {
      title: 'Evening strength',
      sport: 'fitness_equipment',
      sportSubgroup: 'strength_training',
      order: 2,
      exercises: [
        {
          name: 'Squat',
          sets: 3,
          repetitions: '8–10 reps',
          weightKg: 20,
          restSeconds: 90,
          instructions: 'Exercise instruction note',
        },
      ],
    }),
    workout(11, {
      title: 'Morning intervals',
      order: 1,
      durationSeconds: 2705,
      distanceMeters: 8000,
      plannedElevationGainMeters: 0,
      notes: '**Workout note** for printing.',
      steps: [
        {
          kind: 'warmup',
          durationSeconds: null,
          distanceMeters: null,
          endsOnLapButton: true,
          target: null,
          notes: 'Warm-up note',
        },
        {
          kind: 'repeat',
          times: 4,
          steps: [
            {
              kind: 'work',
              durationSeconds: null,
              distanceMeters: 400,
              target: { kind: 'paceSecondsPerKilometer', min: 300, max: 330 },
              notes: 'Interval note',
            },
            {
              kind: 'recovery',
              durationSeconds: 90,
              distanceMeters: null,
              target: null,
              notes: '',
            },
          ],
        },
      ],
      completion: {
        status: 'completed',
        source: 'manual',
        activityId: null,
        performedDate: '2030-01-14',
        durationSeconds: 999,
        distanceMeters: 1234,
        notes: 'Private completion note',
        reason: '',
        rpe: null,
      },
    }),
    workout(12, {
      title: 'Easy ride',
      sport: 'cycling',
      schedule: { kind: 'independent', date: '2030-01-09' },
      durationSeconds: 3600,
    }),
    workout(13, {
      title: 'Rest and reset',
      kind: 'rest',
      sport: null,
      schedule: { kind: 'independent', date: '2030-01-10' },
    }),
    workout(14, {
      title: 'Pool technique',
      sport: 'swimming',
      schedule: { kind: 'independent', date: '2030-01-13' },
      distanceMeters: 1500,
    }),
    workout(15, {
      title: 'Not scheduled',
      schedule: { kind: 'plan', planId: calendarId(2), day: 1 },
    }),
    workout(16, {
      title: 'Outside selected week',
      schedule: { kind: 'independent', date: '2030-01-14' },
    }),
  ];
  return state;
}
