import { z } from 'zod';
import { timezoneSchema, weekStartsOnPreferenceSchema } from './index';

export const preferencesSchema = z.object({
  timezone: timezoneSchema,
  units: z.enum(['metric', 'imperial']),
  weekStartsOnPreference: weekStartsOnPreferenceSchema,
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const onboardingSchema = z.object({
  version: z.literal(1),
  status: z.enum(['pending', 'active', 'deferred', 'completed', 'existing-owner']),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
}).strict();
export type Onboarding = z.infer<typeof onboardingSchema>;
const base = { expectedRevision: z.number().int().positive(), idempotencyKey: z.uuid() };
export const onboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('preferences'), expectedProfileRevision: z.number().int().positive().nullable(), values: preferencesSchema }).strict(),
  z.object({ ...base, action: z.enum(['back', 'continue', 'defer', 'resume', 'complete']) }).strict(),
]);
export type OnboardingAction = z.infer<typeof onboardingActionSchema>;
