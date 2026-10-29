import { emptyWorkspace, planSchema, profileSchema, workoutSchema } from '@athlete-panel/contracts';
import { calendarId as id } from './calendar';

export function plansFixture() {
  const data = emptyWorkspace();
  data.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex Morgan',
    timezone: 'Europe/Paris',
    units: 'metric',
  });
  data.plans = [
    planSchema.parse({
      id: id(500),
      revision: 1,
      title: 'Autumn endurance block',
      startDate: '2030-10-21',
      description:
        'Build a steady aerobic rhythm across riding, running and strength. Keep the easy days conversational and arrive at the weekend with enough energy for the longer ride.\n\nThe first week establishes consistency. In week two, extend the endurance work while keeping the quality session controlled. Adjust around work and recovery; the goal is a repeatable week.',
    }),
    planSchema.parse({
      id: id(501),
      revision: 1,
      title: 'Winter strength & mobility',
      startDate: null,
      description:
        'A flexible strength block to support the next season. Two focused sessions each week, with room for mobility and recovery.',
    }),
    planSchema.parse({
      id: id(502),
      revision: 1,
      title: 'Spring 10 km preparation',
      startDate: '2031-03-03',
      description:
        'Progress from relaxed running to race-specific sessions, with a lighter final week.',
    }),
  ];
  const session = (n: number, day: number, title: string, values: Record<string, unknown> = {}) =>
    workoutSchema.parse({
      id: id(n),
      revision: 1,
      title,
      sport: 'cycling',
      schedule: { kind: 'plan', planId: id(500), day },
      ...values,
    });
  data.workouts = [
    session(510, 1, 'Easy endurance ride', {
      durationSeconds: 2700,
      distanceMeters: 22000,
      notes: 'Relaxed effort. Keep the pace conversational.',
    }),
    session(511, 2, 'Threshold intervals', {
      durationSeconds: 4500,
      distanceMeters: 32000,
      steps: [
        {
          kind: 'warmup',
          durationSeconds: 900,
          target: { kind: 'heartRateBpm', min: 110, max: 130 },
        },
        {
          kind: 'repeat',
          times: 3,
          steps: [
            {
              kind: 'work',
              durationSeconds: 600,
              target: { kind: 'powerWatts', min: 220, max: 245 },
              notes: 'Smooth cadence.\nBuild into each effort.',
            },
            { kind: 'recovery', durationSeconds: 300, target: { kind: 'rpe', min: 2, max: 2 } },
          ],
        },
        {
          kind: 'cooldown',
          distanceMeters: 1609.344,
          target: { kind: 'paceSecondsPerKilometer', min: 300, max: 330 },
        },
      ],
    }),
    session(512, 2, 'Strength & stability', {
      order: 2,
      sport: 'fitness_equipment',
      sportSubgroup: 'strength_training',
      durationSeconds: 1800,
      exercises: [
        {
          name: 'Split squat',
          sets: 3,
          repetitions: '8 each side',
          instructions: 'Controlled tempo.',
        },
        { name: 'Dead bug', sets: 3, repetitions: '10' },
      ],
    }),
    session(513, 3, 'Rest and reset', {
      kind: 'rest',
      sport: null,
      notes: 'Take the day off. An easy walk is optional.',
    }),
    session(514, 4, 'Easy trail run', {
      sport: 'running',
      durationSeconds: 2400,
      distanceMeters: 6000,
      plannedElevationGainMeters: 180,
    }),
    session(515, 6, 'Long endurance ride', {
      durationSeconds: 7200,
      distanceMeters: 58000,
      plannedElevationGainMeters: 650,
    }),
    session(516, 8, 'Recovery spin', { notes: 'Choose the duration on the day.' }),
    session(517, 10, 'Tempo ride', {
      durationSeconds: 3600,
      distanceMeters: 28000,
      steps: [
        { kind: 'repeat', times: 3, steps: [{ kind: 'recovery', durationSeconds: 60 }] },
        { kind: 'work', distanceMeters: 1609.344, target: { kind: 'rpe', min: 4, max: 4 } },
      ],
    }),
    session(518, 14, 'Long easy run', {
      sport: 'running',
      durationSeconds: 4200,
      distanceMeters: 11000,
    }),
    workoutSchema.parse({
      id: id(520),
      revision: 1,
      title: 'Full body strength',
      sport: 'fitness_equipment',
      sportSubgroup: 'strength_training',
      schedule: { kind: 'plan', planId: id(501), day: 1 },
      exercises: [{ name: 'Goblet squat', sets: 3, repetitions: '8' }],
    }),
  ];
  return data;
}
