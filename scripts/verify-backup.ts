import { basename } from 'node:path';
import { verifyBackup } from './restore';
const args = process.argv.slice(2);
if (args.length !== 1) throw new Error('Usage: pnpm exec tsx scripts/verify-backup.ts /backups/archive.fgr');
try {
  const verified = await verifyBackup(args[0], process.env.BACKUP_KEY_FILE ?? '', process.env.ENCRYPTION_KEY ?? '');
  try { console.log(JSON.stringify({ verified: true, file: basename(args[0]), createdAt: verified.metadata.createdAt, release: verified.metadata.release ?? null })); }
  finally { await verified.cleanup(); }
} catch { console.error('Archive verification failed. Check the backup key, application key and selected archive. No database was changed.'); process.exitCode = 1; }
