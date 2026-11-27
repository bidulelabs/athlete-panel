import { z } from 'zod';
import { dateSchema, timestampSchema } from './domain';

export const appleRecordingSourceSchema = z.string().trim().min(1).max(255);

export const appleHealthConnectionSchema = z
  .object({
    uploadUrl: z.url().nullable(),
    connected: z.boolean(),
    testedAt: timestampSchema.nullable(),
    lastUploadAt: timestampSchema.nullable(),
  })
  .strict();

export type AppleHealthConnection = z.infer<typeof appleHealthConnectionSchema>;

export const appleHealthStatusSchema = appleHealthConnectionSchema
  .extend({
    importedFrom: dateSchema.nullable(),
    importedTo: dateSchema.nullable(),
    sources: z.array(z.object({ name: appleRecordingSourceSchema, excluded: z.boolean() })),
    lastBatch: z
      .object({
        imported: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
        issues: z.array(z.string().max(400)).max(10),
        issueCount: z.number().int().nonnegative(),
      })
      .nullable(),
    error: z.string().max(400).nullable(),
  })
  .strict();

export type AppleHealthStatus = z.infer<typeof appleHealthStatusSchema>;
