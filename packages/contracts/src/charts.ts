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
export const chartsSports = [
  'running',
  'cycling',
  'winter_sports',
  'hiking',
  'swimming',
  'other',
] as const;
export type ChartsSport = (typeof chartsSports)[number];
export const chartsGroupings = ['day', 'week', 'month'] as const;
export type ChartsGrouping = (typeof chartsGroupings)[number];
export const chartsVolumeTemplates = [
  'training-hours',
  'training-by-sport',
  'weekly-climbing',
] as const;
export const isChartsVolumeTemplate = (template: string) =>
  chartsVolumeTemplates.some((value) => value === template);
const selectedSportsSchema = z
  .array(z.enum(chartsSports))
  .min(1)
  .max(chartsSports.length)
  .refine((sports) => new Set(sports).size === sports.length, 'Choose each sport only once.');
export const chartsSummaryInputSchema = z
  .object({
    template: z.enum(chartsTemplates),
    weekStart: dateSchema,
    weeks: z.number().int().min(1).max(chartsMaxWeeks),
    grouping: z.enum(chartsGroupings).optional(),
    sports: selectedSportsSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      isChartsVolumeTemplate(input.template) ||
      (input.grouping === undefined && input.sports === undefined),
    'Sport selection and grouping are only supported by the volume templates.',
  );
export const chartsWeekSchema = z.object({
  weekStart: dateSchema,
});
const chartsTargetSchema = z
  .object({ min: z.number(), max: z.number() })
  .nullable()
  .describe(
    'Phase target for the bucket, every sport included; null for days, a sport selection, weeks outside every phase or a phase without this target.',
  );
export const chartsBucketSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  partial: z.boolean(),
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
  targetSeconds: chartsTargetSchema,
  targetElevationMeters: chartsTargetSchema,
});
export const chartsVolumeSchema = z.object({
  grouping: z.enum(chartsGroupings),
  sports: selectedSportsSchema,
  buckets: z
    .array(chartsBucketSchema)
    .min(1)
    .max(chartsMaxWeeks * 7),
});
export type ChartsBucket = z.infer<typeof chartsBucketSchema>;
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
  volume: chartsVolumeSchema.nullable(),
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
