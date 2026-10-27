import { z } from 'zod';
import { recoveryStatusSchema } from './import-recovery';
export const garminConnectionSchema = z.object({
  connected: z.boolean(),
  recovery: recoveryStatusSchema.optional(),
  verified: z.boolean().optional(),
  paused: z.boolean(),
  lastError: z.string().nullable(),
  lastErrorCode: z.string().nullable().optional(),
  checkedAt: z.iso.datetime().optional(),
  historyStatus: z.string().nullable().optional(),
  currentJob: z
    .object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      progress: z.string(),
      nextRunAt: z.iso.datetime().nullable(),
      retrying: z.boolean(),
    })
    .nullable()
    .optional(),
  coverageSummary: z
    .object({
      windows: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      complete: z.number().int().nonnegative(),
      empty: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative().optional(),
      rejected: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type GarminConnection = z.infer<typeof garminConnectionSchema>;
