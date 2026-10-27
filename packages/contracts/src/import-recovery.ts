import { z } from 'zod';
import { dateSchema } from './domain';

export const importStreamSchema = z.enum([
  'activities',
  'sleep',
  'daily',
  'hrv',
  'steps',
  'stress',
  'bodyBattery',
]);
export type ImportStream = z.infer<typeof importStreamSchema>;
export const rejectionDiagnosticSchema = z.object({
  stream: importStreamSchema,
  from: dateSchema.nullable(),
  to: dateSchema,
  pageOffset: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  identifier: z
    .string()
    .regex(/^\d{1,128}$/)
    .optional(),
  date: dateSchema.optional(),
  fields: z.array(z.string().max(160)).max(8),
  code: z.enum([
    'invalid_record',
    'invalid_identifier',
    'invalid_date',
    'outside_window',
    'schema_validation',
  ]),
});
export type RejectionDiagnostic = z.infer<typeof rejectionDiagnosticSchema>;
export const scanStateSchema = z.enum([
  'unscanned',
  'in-progress',
  'scanned',
  'failed',
  'unavailable',
]);
export const activityScanSchema = z.object({
  records: z.number().int().nonnegative(),
  rejectedRecords: z.number().int().nonnegative(),
  diagnostics: z.array(rejectionDiagnosticSchema).max(50),
  oldestReturnedDate: dateSchema.nullable(),
});
export type ActivityScan = z.infer<typeof activityScanSchema>;
