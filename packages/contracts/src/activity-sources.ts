import { z } from 'zod';
import { activityProviderSchema } from './domain';
import { appleHealthConnectionSchema } from './apple-health';

export const activitySourceChoiceSchema = z.object({ source: activityProviderSchema }).strict();
export const activitySourceChoicesSchema = z.array(activityProviderSchema).max(2);
export const activitySourcesSchema = z
  .object({
    selected: activitySourceChoicesSchema,
    appleHealth: appleHealthConnectionSchema.nullable(),
  })
  .strict();

export type ActivitySources = z.infer<typeof activitySourcesSchema>;
