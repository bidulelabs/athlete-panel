import { z } from 'zod';
import { dateSchema, idSchema } from './domain';
import { historyMeasureSchema } from './history';

export const chartsMaxWeeks = 53;
export const chartsSummaryInputSchema = z
  .object({ weekStart: dateSchema, weeks: z.number().int().min(1).max(chartsMaxWeeks) })
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
  recordedRunningDistanceMeters: historyMeasureSchema,
});
export const chartsRaceSchema = z.object({ id: idSchema, date: dateSchema, title: z.string() });
export const chartsActivitySchema = z.object({
  id: idSchema,
  date: dateSchema,
  title: z.string(),
  sport: z.enum(chartsSports),
  averageHeartRateBpm: z.number().nullable(),
  durationSeconds: z.number().nullable(),
});
export const chartsSummarySchema = z.object({
  weeks: z.array(chartsWeekSchema),
  races: z.array(chartsRaceSchema),
  activities: z.array(chartsActivitySchema),
});
export type ChartsSummaryInput = z.infer<typeof chartsSummaryInputSchema>;
export type ChartsSummary = z.infer<typeof chartsSummarySchema>;
export type ChartsActivity = z.infer<typeof chartsActivitySchema>;
