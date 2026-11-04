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
});
export const chartsRaceSchema = z.object({ id: idSchema, date: dateSchema, title: z.string() });
export const chartsSummarySchema = z.object({
  weeks: z.array(chartsWeekSchema),
  races: z.array(chartsRaceSchema),
});
export type ChartsSummaryInput = z.infer<typeof chartsSummaryInputSchema>;
export type ChartsSummary = z.infer<typeof chartsSummarySchema>;
