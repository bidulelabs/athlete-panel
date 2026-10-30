import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const imageMetadataSchema = z
  .object({
    application: z.literal('athlete-panel'),
    hostedProtocol: z.literal(1),
    imageIdentityVersion: z.literal(1).optional(),
    version: z.string().min(1).max(128),
    sourceDigest: digest,
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    plugins: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9-]*$/),
          version: z.string(),
          enabled: z.boolean(),
          path: z.string().regex(/^(plugins|personal-plugins)\/[a-z][a-z0-9-]*$/),
        })
        .strict(),
    ),
  })
  .strict();

export async function readImageMetadata(root: string) {
  const contents = await readFile(join(root, '.athlete-panel-release.json'), 'utf8');
  return imageMetadataSchema.parse(JSON.parse(contents));
}

/** Portable content identity; the local Docker identifier is recorded separately. */
export const portableImageIdentitySchema = z
  .object({
    format: z.literal(1),
    os: z.literal('linux'),
    architecture: z.string().min(1),
    variant: z.string(),
    configDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    manifestDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    indexDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

/** Older authenticated archives without portable identity remain readable. */
export const releasedImageSchema = z
  .object({
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    identity: portableImageIdentitySchema.optional(),
    registryRef: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/)
      .nullable(),
    sourceDigest: digest,
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    version: z.string().min(1).max(128),
    kind: z.enum(['registry', 'local', 'source']),
  })
  .strict();
export type ReleasedImage = z.infer<typeof releasedImageSchema>;
