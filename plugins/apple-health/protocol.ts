import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { z } from 'zod';
import { timestampSchema } from '@athlete-panel/contracts';
import { AppError } from '../../packages/host/src/errors';
import { readBytes } from '../../packages/host/src/http';

const payloadLimit = 32 * 1024 * 1024;
const batchLimit = 5000;
const unpack = promisify(gunzip);
export const workoutUuid = z.uuid().transform((id) => id.toLowerCase());
export const appleTimestamp = timestampSchema.refine((value) => Number.isFinite(Date.parse(value)));

const envelopeSchema = z
  .object({
    app: z.literal('salute-libera'),
    versione: z.literal(1),
    prova: z.literal(true).optional(),
    diagnostica: z.object({}),
  })
  .partial({ diagnostica: true });
const batchSchema = z
  .object({
    inviato: appleTimestamp,
    allenamenti: z.array(z.unknown()).max(batchLimit).default([]),
    // The protocol uses a single list for deletions of every sample type.
    eliminati: z.array(workoutUuid).max(batchLimit).default([]),
  })
  .refine((batch) => batch.allenamenti.length + batch.eliminati.length <= batchLimit);

export type WorkoutBatch = z.infer<typeof batchSchema>;

export function parseUpload(payload: unknown) {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success)
    throw new AppError('invalid_apple_upload', 'Use a Sync for Health version 1 upload.', 400);
  if (envelope.data.prova || envelope.data.diagnostica) {
    if (
      (envelope.data.prova && envelope.data.diagnostica) ||
      Object.hasOwn(payload as object, 'allenamenti') ||
      Object.hasOwn(payload as object, 'eliminati')
    )
      throw new AppError(
        'invalid_apple_upload',
        'Send workout batches separately from tests and diagnostics.',
        400,
      );
    return { kind: envelope.data.prova ? ('test' as const) : ('diagnostics' as const) };
  }
  const batch = batchSchema.safeParse(payload);
  if (!batch.success)
    throw new AppError(
      'invalid_apple_batch',
      'The workout batch has an invalid date, deletion ID, or size.',
      400,
    );
  return { kind: 'batch' as const, batch: batch.data };
}

export async function readUpload(request: Request) {
  const encoding = request.headers.get('content-encoding')?.toLowerCase() ?? 'identity';
  if (encoding !== 'identity' && encoding !== 'gzip')
    throw new AppError(
      'invalid_apple_encoding',
      'Use a JSON upload with optional gzip compression.',
      415,
    );
  const tooLarge =
    'The upload exceeds 32 MiB. Turn off GPS workout routes and retry history from the iPhone.';
  const bytes = await readBytes(request, payloadLimit, tooLarge);
  let decoded = bytes;
  if (encoding === 'gzip') {
    try {
      decoded = await unpack(bytes, { maxOutputLength: payloadLimit });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
        throw new AppError('too_large', tooLarge, 413);
      throw new AppError(
        'invalid_apple_gzip',
        'The compressed upload is invalid. Retry from the iPhone.',
        400,
      );
    }
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
  } catch {
    throw new AppError('invalid_json', 'The upload must contain valid UTF-8 JSON.', 400);
  }
  return parseUpload(payload);
}
