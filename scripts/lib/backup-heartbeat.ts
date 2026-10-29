import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
});
const configuration = z.object({ success: endpoint, failure: endpoint.optional() }).strict();

/** Ping URLs are secrets. Never include URLs, bodies or fetch errors in diagnostics. */
export async function backupHeartbeat(
  outcome: 'success' | 'failure',
  file = process.env.BACKUP_HEARTBEAT_FILE,
  request: typeof fetch = fetch,
): Promise<'unconfigured' | 'sent' | 'failed'> {
  if (!file) return 'unconfigured';
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) return 'failed';
    const settings = configuration.parse(JSON.parse(await readFile(file, 'utf8')));
    const url = settings[outcome];
    if (!url) return 'unconfigured';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await request(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        if (response.ok) return 'sent';
      } catch {
        // Bounded retries; the external monitor also notices absent success pings.
      }
    }
  } catch {
    // Private configuration and remote diagnostics stay out of logs/status.
  }
  return 'failed';
}
