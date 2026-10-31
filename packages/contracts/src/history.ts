import { z } from 'zod';
import {
  dateSchema,
  historyCategorySchema,
  historyScopeSchema,
  healthMetricSchema,
  profileSchema,
} from './domain';

export const HISTORY_PAGE_BYTES = 1024 * 1024;
export const historyKindSchema = z.enum([
  'activities',
  'health',
  'workouts',
  'plans',
  'notes',
  'events',
  'injuries',
  'coverage',
]);
export const historyQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    category: historyKindSchema.optional(),
    sport: z.string().min(1).max(100).optional(),
    subgroup: z.string().min(1).max(100).optional(),
    metric: healthMetricSchema.optional(),
    period: z.enum(['month', 'week']).default('month'),
    limit: z.number().int().min(1).max(200).default(100),
    reviewToken: z.string().min(1).max(8192).optional(),
    cursor: z.string().min(1).max(16384).optional(),
    recordId: z.uuid().optional(),
    section: z.enum(['core', 'steps', 'exercises']).default('core'),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type HistorySelection = HistoryQuery & {
  from: string;
  to: string;
  after?: { date: string; id: string };
  take: number;
  facts?: boolean;
};
const number = z.number().finite().nonnegative().nullable();
/** Deliberately flat historical facts; provider payloads and unrelated workspace fields have no representation. */
export const historyDataSchema = z.object({
  revision: z.number().optional(),
  title: z.string().optional(),
  sport: z.string().nullable().optional(),
  subgroup: z.string().nullable().optional(),
  sportResolution: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  durationSeconds: number.optional(),
  distanceMeters: number.optional(),
  elevationMeters: number.optional(),
  averageHeartRateBpm: number.optional(),
  startedAt: z.string().nullable().optional(),
  dateSource: z.string().nullable().optional(),
  source: z.string().optional(),
  sourceStream: z.string().nullable().optional(),
  externalId: z.string().optional(),
  metric: z.string().optional(),
  value: number.optional(),
  measuredAt: z.string().nullable().optional(),
  restingHeartRateMayBeMinimum: z.boolean().optional(),
  scheduledDate: z.string().nullable().optional(),
  performedDate: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
  completionStatus: z.string().nullable().optional(),
  completionSource: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  actualDurationSeconds: number.optional(),
  actualDistanceMeters: number.optional(),
  rpe: number.optional(),
  notes: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  reason: z.string().optional(),
  completionNotes: z.string().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  bodyPart: z.string().optional(),
  severity: z.string().optional(),
  stepCount: z.number().int().optional(),
  exerciseCount: z.number().int().optional(),
  // Prescription parts remain individual bounded items; their schema is validated by the owning service.
  part: z.record(z.string(), z.unknown()).optional(),
  stream: z.string().optional(),
  scanState: z.string().optional(),
  lastScannedAt: z.string().nullable().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.string().optional(),
  unsupportedFields: z.array(z.string()).optional(),
});
export const historyRecordSchema = z.object({
  category: historyKindSchema,
  id: z.string(),
  date: dateSchema,
  data: historyDataSchema,
});
export type HistoryRecord = z.infer<typeof historyRecordSchema>;
export const historyMeasureSchema = z.object({
  value: number,
  knownCount: z.number().int(),
  missingCount: z.number().int(),
});
export const historySummarySchema = z.object({
  category: z.enum(['activities', 'planned', 'actual', 'health', 'coverage']),
  from: dateSchema,
  to: dateSchema,
  periodStart: dateSchema,
  partial: z.boolean(),
  calendarDays: z.number().int(),
  sport: z.string().nullable().optional(),
  subgroup: z.string().nullable().optional(),
  source: z.string().optional(),
  sourceStream: z.string().optional(),
  metric: z.string().optional(),
  unit: z.string().optional(),
  count: z.number().int(),
  activeDays: z.number().int().optional(),
  sessionsPerSevenDays: z.number().optional(),
  durationSeconds: historyMeasureSchema.optional(),
  distanceMeters: historyMeasureSchema.optional(),
  elevationMeters: historyMeasureSchema.optional(),
  statuses: z.record(z.string(), z.number()).optional(),
  possibleDuplicateCount: z.number().optional(),
  mean: number.optional(),
  min: number.optional(),
  max: number.optional(),
  sum: number.optional(),
  contributingRecords: z.number().int().optional(),
  contributingDays: z.number().int().optional(),
  missingDays: z.number().int().optional(),
  unknownDays: z.number().int().optional(),
  ambiguousDays: z.number().int().optional(),
  uncertainRecords: z.number().int().optional(),
  unsupportedRecords: z.number().int().optional(),
  scannedDays: z.number().int().optional(),
  failedDays: z.number().int().optional(),
  unavailableDays: z.number().int().optional(),
  unscannedDays: z.number().int().optional(),
  reference: historyQuerySchema,
  detailReferences: z.array(historyQuerySchema).max(2).optional(),
});
export type HistorySummary = z.infer<typeof historySummarySchema>;
export const historyResponseSchema = z.object({
  version: z.literal(1),
  operation: z.enum(['discover', 'summary', 'records', 'context']),
  scope: historyScopeSchema,
  reviewToken: z.string(),
  expiresAt: z.string(),
  asOf: z.string(),
  query: historyQuerySchema,
  nextCursor: z.string().nullable(),
  records: z.array(historyRecordSchema).max(200).optional(),
  summaries: z.array(historySummarySchema).max(200).optional(),
  profile: profileSchema.nullable().optional(),
  profileMeaning: z.literal('Current profile; not historical settings.').optional(),
  availability: z
    .array(
      z.object({
        category: historyKindSchema,
        count: z.number().int(),
        from: dateSchema.nullable(),
        to: dateSchema.nullable(),
      }),
    )
    .optional(),
  categories: z.array(historyCategorySchema).optional(),
  supportedFilters: z
    .object({
      sportCategories: z.array(historyKindSchema),
      healthMetrics: z.array(healthMetricSchema),
      periods: z.array(z.enum(['month', 'week'])),
      prescriptionSections: z.array(z.enum(['steps', 'exercises'])),
    })
    .optional(),
  warnings: z.array(z.string()),
});
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
/** Invalid optional legacy fields are visible diagnostics, never fabricated measurements. */
export function historicalRecord(
  category: HistoryRecord['category'],
  id: string,
  date: string,
  input: Record<string, unknown>,
): HistoryRecord {
  const data: Record<string, unknown> = {},
    unsupported: string[] = [];
  for (const [name, schema] of Object.entries(historyDataSchema.shape)) {
    if (input[name] === undefined) continue;
    const parsed = schema.safeParse(input[name]);
    if (parsed.success) data[name] = parsed.data;
    else unsupported.push(name);
  }
  if (unsupported.length) data.unsupportedFields = unsupported;
  return historyRecordSchema.parse({ category, id, date, data });
}
