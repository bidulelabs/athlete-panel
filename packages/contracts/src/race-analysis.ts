import { z } from 'zod';
import { dateSchema } from './domain';

export const raceFileLimit = 10 * 1024 * 1024;
export const racePointLimit = 100000;
export const terrainLevelSchema = z.number().int().min(1).max(5);
const meters = z.number().finite().nonnegative();
const seconds = z
  .number()
  .finite()
  .positive()
  .max(30 * 86400);
export const racePointSchema = z.object({
  distanceMeters: meters,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevationMeters: z.number().finite().nullable(),
  slopePercent: z.number().finite().nullable(),
  segment: z.number().int().nonnegative(),
});
export const courseSectionSchema = z.object({
  index: z.number().int().nonnegative(),
  fromMeters: meters,
  toMeters: meters,
  ascentMeters: meters.nullable(),
  descentMeters: meters.nullable(),
});
export const trackAnalysisSchema = z.object({
  distanceMeters: meters,
  ascentMeters: meters.nullable(),
  descentMeters: meters.nullable(),
  rawAscentMeters: meters.nullable(),
  elevationCoverage: z.number().min(0).max(1),
  elapsedSeconds: seconds.nullable(),
  pointCount: z.number().int().min(2).max(racePointLimit),
  hasGaps: z.boolean(),
  warnings: z.array(z.string()),
  points: z.array(racePointSchema).max(2000),
  sections: z.array(courseSectionSchema).max(200),
});
export const raceAssetSchema = z.object({
  id: z.uuid(),
  filename: z.string().min(1).max(255),
  format: z.enum(['gpx', 'fit']),
  bytes: z.number().int().positive().max(raceFileLimit),
  importedAt: z.string(),
  analysis: trackAnalysisSchema,
});
export const referenceEffortSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  filename: z.string(),
  distanceMeters: meters,
  ascentMeters: meters.nullable(),
  durationSeconds: seconds.nullable(),
  durationSource: z.enum(['file', 'owner', 'missing']),
  terrain: terrainLevelSchema,
  hasGaps: z.boolean(),
  predictedSeconds: seconds.nullable(),
  comparison: z.enum(['held-out', 'unavailable']),
});
export const courseEstimateSchema = z.object({
  seconds,
  lowSeconds: seconds,
  highSeconds: seconds,
  paceSecondsPerKm: z.number().positive(),
  climbSecondsPer100m: z.number().nonnegative(),
  fatiguePerHour: z.number().nonnegative(),
  referenceCount: z.number().int().nonnegative(),
  harderTerrainSeconds: z.number().nonnegative().nullable(),
  sectionSeconds: z.array(z.number().nonnegative()),
  explanations: z.array(z.string()),
});
export const raceAnalysisSchema = z.object({
  race: z.object({ id: z.uuid(), title: z.string(), date: dateSchema, revision: z.number().int() }),
  revision: z.number().int().nonnegative(),
  course: raceAssetSchema.nullable(),
  terrain: terrainLevelSchema,
  sectionTerrain: z.record(z.string(), terrainLevelSchema),
  references: z.array(referenceEffortSchema).max(20),
  estimate: courseEstimateSchema.nullable(),
  estimateReasons: z.array(z.string()),
});
export const raceSelectionSchema = z.object({ raceId: z.uuid() }).strict();
const mutation = {
  raceId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.uuid(),
};
export const raceSettingsInputSchema = z
  .object({
    ...mutation,
    terrain: terrainLevelSchema,
    sectionTerrain: z.record(z.string().regex(/^\d{1,3}$/), terrainLevelSchema),
  })
  .strict();
export const raceReferenceUpdateSchema = z
  .object({
    ...mutation,
    id: z.uuid(),
    title: z.string().trim().min(1).max(160),
    durationSeconds: seconds.nullable(),
    terrain: terrainLevelSchema,
  })
  .strict();
export const raceReferenceRemoveSchema = z.object({ ...mutation, id: z.uuid() }).strict();
export const raceUploadInputSchema = z.discriminatedUnion('purpose', [
  z.object({ ...mutation, purpose: z.literal('course') }).strict(),
  z
    .object({
      ...mutation,
      purpose: z.literal('reference'),
      title: z.string().trim().min(1).max(160),
      durationSeconds: seconds.nullable(),
      terrain: terrainLevelSchema,
    })
    .strict(),
]);
export const raceMutationResultSchema = z.object({
  revision: z.number().int().positive(),
  assetId: z.uuid().optional(),
});
export type RacePoint = z.infer<typeof racePointSchema>;
export type TrackAnalysis = z.infer<typeof trackAnalysisSchema>;
export type CourseSection = z.infer<typeof courseSectionSchema>;
export type RaceAnalysis = z.infer<typeof raceAnalysisSchema>;
export type RaceAsset = z.infer<typeof raceAssetSchema>;
export type ReferenceEffort = z.infer<typeof referenceEffortSchema>;
export type CourseEstimate = z.infer<typeof courseEstimateSchema>;
export type RaceUploadInput = z.infer<typeof raceUploadInputSchema>;
