import { z } from 'zod';
import {
  workspaceStateSchema,
  profileSchema,
  planSchema,
  workoutSchema,
  noteSchema,
  eventSchema,
  injurySchema,
  activitySchema,
  healthRecordSchema,
  dateSchema,
} from './domain';
import { onboardingSchema } from './onboarding';
import { garminConnectionSchema } from './garmin-connection';
import { rejectionDiagnosticSchema, scanStateSchema } from './import-recovery';

const change = <K extends string, T extends z.ZodType>(entity: K, schema: T) =>
  z.object({
    entity: z.literal(entity),
    id: z.string(),
    before: schema.nullable(),
    after: schema.nullable(),
    beforeEffectiveDate: dateSchema.nullable().optional(),
    afterEffectiveDate: dateSchema.nullable().optional(),
  });
export const entityChangeSchema = z.discriminatedUnion('entity', [
  change('profile', profileSchema),
  change('plan', planSchema),
  change('workout', workoutSchema),
  change('note', noteSchema),
  change('event', eventSchema),
  change('injury', injurySchema),
  change('activity', activitySchema),
  change('health', healthRecordSchema),
]);
export const mutationResponseSchema = z.object({
  id: z.uuid(),
  changes: z.array(entityChangeSchema),
});
export type MutationResponse = z.infer<typeof mutationResponseSchema>;
export const pluginInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  desiredEnabled: z.boolean(),
  required: z.boolean(),
  dependencies: z.array(z.string()),
  pending: z.boolean(),
});
export type PluginInfo = z.infer<typeof pluginInfoSchema>;
export const coverageRowSchema = z.object({
  stream: z.string(),
  from: dateSchema,
  to: dateSchema,
  status: z.string(),
  records: z.number().int().nonnegative(),
  missingDays: z.number().int().nonnegative(),
  unknownMetrics: z.number().int().nonnegative(),
  error: z.string().nullable(),
  scanState: scanStateSchema.optional(),
  lastScannedAt: z.iso.datetime().nullable().optional(),
  rejectedRecords: z.number().int().nonnegative().default(0),
  diagnostics: z.array(rejectionDiagnosticSchema).max(50).default([]),
});
export type CoverageRow = z.infer<typeof coverageRowSchema>;
export const coveragePageSchema = z.object({
  rows: z.array(coverageRowSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export const garminStatusSchema = garminConnectionSchema.extend({
  earliestDate: dateSchema.nullable(),
  accountId: z.string().optional(),
  lastSync: z.iso.datetime().nullable(),
  status: z.string(),
  coverage: z.array(coverageRowSchema),
});
export const proposalSummarySchema = z.object({
  expiresAt: z.iso.datetime().optional(),
  id: z.uuid(),
  status: z.enum(['pending', 'applied', 'rejected']),
  digest: z.string(),
  createdAt: z.iso.datetime(),
  changes: z.array(entityChangeSchema),
  summary: z.string(),
  warnings: z.array(
    z.union([z.string(), z.object({ message: z.string().optional() }).passthrough()]),
  ),
});
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;
export const grantSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  expiresAt: z.iso.datetime(),
  revoked: z.boolean(),
  from: dateSchema,
  to: dateSchema,
  includeNotes: z.boolean(),
});
export type GrantSummary = z.infer<typeof grantSummarySchema>;
export const auditEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  summary: z.string(),
  undoneAt: z.iso.datetime().nullable(),
  undoable: z.boolean().optional(),
  changes: z.array(entityChangeSchema),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const jobSummarySchema = z.object({
  id: z.uuid(),
  status: z.string(),
  kind: z.string(),
  progress: z.string(),
  error: z.string().nullable(),
  nextRunAt: z.iso.datetime(),
  attempts: z.number().int().nonnegative(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;
// Known operational fields are checked; ancillary settings stay available for compatible readers.
export const workerStatusSchema = z
  .object({
    id: z.string().optional(),
    lastSeen: z.iso.datetime().optional(),
    lastSuccess: z.iso.datetime().optional(),
    lastFailure: z.iso.datetime().optional(),
    state: z.enum(['healthy', 'maintenance', 'failed', 'degraded']).optional(),
    schedulerFailures: z.array(z.string()).optional(),
    consecutiveFailures: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export const operationalValuesSchema = z.object({
  worker: workerStatusSchema.nullable().optional(),
  lastBackup: z
    .object({
      completedAt: z.iso.datetime().optional(),
      storage: z.string().optional(),
      verifiedAt: z.iso.datetime().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  backupAttempt: z
    .object({ state: z.string().optional(), startedAt: z.iso.datetime().optional() })
    .passthrough()
    .nullable()
    .optional(),
  backupSchedule: z
    .object({ nextRunAt: z.iso.datetime().optional() })
    .passthrough()
    .nullable()
    .optional(),
  composition: z.unknown().optional(),
  schema: z
    .array(z.object({ pluginId: z.string(), name: z.string(), appliedAt: z.iso.datetime() }))
    .optional(),
});
export type OperationalValues = z.infer<typeof operationalValuesSchema>;
export const operationalEntrySchema = z
  .object({ key: z.string(), value: z.unknown() })
  .superRefine((entry, ctx) => {
    const parsed = operationalValuesSchema.safeParse({ [entry.key]: entry.value });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: 'custom',
          path: ['value', ...issue.path.slice(1)],
          message: issue.message,
        });
  });
export const workspaceEnvelopeSchema = z.object({
  state: workspaceStateSchema,
  onboarding: onboardingSchema.optional(),
  plugins: z.array(pluginInfoSchema),
  garmin: garminStatusSchema,
  proposals: z.array(proposalSummarySchema),
  grants: z.array(grantSummarySchema),
  changes: z.array(auditEntrySchema),
  jobs: z.array(jobSummarySchema),
  operational: z.array(operationalEntrySchema).optional(),
});
export type WorkspaceEnvelope = z.infer<typeof workspaceEnvelopeSchema>;
export const onboardingStatusSchema = z.object({
  onboarding: onboardingSchema,
  worker: workerStatusSchema.nullable(),
  garmin: garminConnectionSchema.passthrough(),
});
const errorSchema = z.object({
  error: z
    .union([z.string(), z.object({ message: z.string(), details: z.unknown().optional() })])
    .optional(),
  message: z.string().optional(),
});
export function responseError(value: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(value);
  if (!parsed.success) return fallback;
  const error = parsed.data.error;
  const message =
    typeof error === 'string' ? error : (error?.message ?? parsed.data.message ?? fallback);
  const details =
    typeof error === 'object'
      ? z.array(z.object({ message: z.string() })).safeParse(error.details)
      : null;
  return [
    message,
    ...(details?.success ? details.data.slice(0, 3).map((issue) => issue.message) : []),
  ].join(' ');
}

export type CoveragePage = z.infer<typeof coveragePageSchema>;
