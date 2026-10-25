import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const imageMetadataSchema = z.object({
  application: z.literal('athlete-panel'), hostedProtocol: z.literal(1),
  version: z.string().min(1).max(128), sourceDigest: digest,
  plugins: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), version: z.string(),
    enabled: z.boolean(), path: z.string().regex(/^(plugins|personal-plugins)\/[a-z][a-z0-9-]*$/) }).strict()),
}).strict();

export async function readImageMetadata(root: string) {
  const contents = await readFile(join(root, '.athlete-panel-release.json'), 'utf8');
  return imageMetadataSchema.parse(JSON.parse(contents));
}

/** Registry digest and local image ID are different identities; retain both. */
export const releasedImageSchema = z.object({
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  registryRef: z.string().regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/).nullable(),
  sourceDigest: digest, version: z.string().min(1).max(128),
  kind: z.enum(['registry', 'local', 'source']),
}).strict();
export type ReleasedImage = z.infer<typeof releasedImageSchema>;
