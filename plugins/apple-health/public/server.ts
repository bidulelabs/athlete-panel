import { digest } from '../../../packages/host/src/crypto';
import { transaction } from '../../../packages/host/src/db';
import { AppError, assert } from '../../../packages/host/src/errors';
import { importWorkouts } from '../import';
import { readUpload } from '../protocol';
import { recordUploadError, requireUploadToken } from '../repository';

export { readAppleHealthConnection } from '../repository';

export async function receiveAppleUpload(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get('authorization') ?? '',
  )?.[1];
  assert(token, 'unauthorized', 'A valid Apple Health upload token is required.', 401);
  const hash = digest(token);
  await requireUploadToken(hash);
  try {
    const upload = await readUpload(request);
    await transaction(async (tx) => {
      await requireUploadToken(hash, tx);
      if (upload.kind === 'test') {
        await tx`update apple_health.connection set tested_at=now(),last_error=null where singleton`;
      } else if (upload.kind === 'batch') {
        await importWorkouts(tx, upload.batch);
      }
    });
  } catch (error) {
    const message =
      error instanceof AppError && error.status < 500
        ? error.message
        : 'The upload could not be saved. Retry from Sync for Health on the iPhone.';
    // Keep the original response if the database is unavailable or the instance is paused.
    await recordUploadError(hash, message).catch(() => {});
    throw error;
  }
}
