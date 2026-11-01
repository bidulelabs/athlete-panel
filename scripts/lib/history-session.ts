import { z } from 'zod';
import { lstat, readFile } from 'node:fs/promises';
import { historyResponseSchema, type HistoryResponse } from '../../packages/contracts/src';

export type HistorySession = { path: string; identity: string };

/** A private CLI sidecar stores discovery metadata, never credentials or historical records. */
export async function historySession(
  session: HistorySession,
  restart: boolean,
  request: (path: string, body: unknown) => Promise<unknown>,
  save: (path: string, text: string) => Promise<void>,
): Promise<HistoryResponse> {
  if (!restart) {
    try {
      const info = await lstat(session.path);
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
        throw new Error('History review storage must be a private regular file (mode 0600).');
      const cached: unknown = JSON.parse(await readFile(session.path, 'utf8'));
      if (!cached || typeof cached !== 'object' || !('identity' in cached) || !('review' in cached))
        throw new Error('Saved history review is invalid. Repeat the command with --restart.');
      if (cached.identity === session.identity) return historyResponseSchema.parse(cached.review);
      // A newly approved connection always starts its own review.
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        // eslint-disable-next-line preserve-caught-error -- Parser details may expose private review metadata.
        throw new Error('Saved history review is invalid. Repeat the command with --restart.');
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const review = historyResponseSchema.parse(await request('history-discover', {}));
  await save(session.path, JSON.stringify({ identity: session.identity, review }) + '\n');
  return review;
}
