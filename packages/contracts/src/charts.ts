import { z } from 'zod';
import { dateSchema, idSchema } from './domain';
import { historyMeasureSchema } from './history';

export const chartsMaxWeeks = 53;
export const chartsUsualRangeLookbackNights = 60;
export const chartsTemplates = [
  'training-hours',
  'training-by-sport',
  'workout-heart-rate',
  'weekly-climbing',
  'resting-heart-rate-hrv',
  'estimated-training-load',
] as const;
export const chartsLongLoadAverageDays = 42;
export const chartsSummaryInputSchema = z
  .object({
    template: z.enum(chartsTemplates),
    weekStart: dateSchema,
    weeks: z.number().int().min(1).max(chartsMaxWeeks),
  })
  .strict();
export const chartsSports = [
  'running',
  'cycling',
  'winter_sports',
  'hiking',
  'swimming',
  'other',
] as const;
export type ChartsSport = (typeof chartsSports)[number];
export const chartsWeekSchema = z.object({
  weekStart: dateSchema,
  plannedSeconds: historyMeasureSchema,
  recordedSeconds: historyMeasureSchema,
  recordedSecondsBySport: z.record(z.enum(chartsSports), historyMeasureSchema),
  recordedElevationMetersBySport: z.record(z.enum(chartsSports), historyMeasureSchema),
  runningClimb: z.object({
    sessionCount: z.number().int(),
    measuredSessionCount: z.number().int(),
    elevationMeters: z.number(),
    distanceMeters: z.number(),
  }),
});
export const chartsRaceSchema = z.object({ id: idSchema, date: dateSchema, title: z.string() });
export const chartsSessionSchema = z.object({
  id: idSchema,
  date: dateSchema,
  title: z.string(),
  sport: z.enum(chartsSports),
  averageHeartRateBpm: z.number().nullable(),
  durationSeconds: z.number().nullable(),
});
export const chartsNightSchema = z.object({
  date: dateSchema,
  restingHeartRateBpm: z.number().nullable(),
  restingHeartRateMayBeMinimum: z.boolean(),
  hrvMilliseconds: z.number().nullable(),
});
export const chartsLoadSessionSchema = z.object({
  date: dateSchema,
  averageHeartRateBpm: z.number().nullable(),
  durationSeconds: z.number().nullable(),
});
export const chartsSummarySchema = z.object({
  weeks: z.array(chartsWeekSchema),
  races: z.array(chartsRaceSchema),
  sessions: z.array(chartsSessionSchema),
  nights: z.array(chartsNightSchema),
  trainingLoadSessions: z.array(chartsLoadSessionSchema),
});
export type ChartsSummaryInput = z.infer<typeof chartsSummaryInputSchema>;
export type ChartsSummary = z.infer<typeof chartsSummarySchema>;
export type ChartsSession = z.infer<typeof chartsSessionSchema>;
export type ChartsNight = z.infer<typeof chartsNightSchema>;
export type ChartsLoadSession = z.infer<typeof chartsLoadSessionSchema>;
