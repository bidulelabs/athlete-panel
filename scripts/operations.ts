import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeDatabase, connection } from '../packages/host/src/db';
import { checkSchema } from '../packages/host/src/schema';
import { createBackup } from './backup';
import { backupHeartbeat } from './lib/backup-heartbeat';
import { operationalHealth } from '../packages/ui/src/operational-status';

export async function setMaintenance(enabled: boolean): Promise<void> {
  await connection().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    await tx`insert into host.settings(key,value) values('maintenance',${tx.json(enabled)}) on conflict(key) do update set value=excluded.value`;
  });
}

export function nextBackupTime(now: Date, hourUtc = 3): Date {
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23)
    throw new Error('BACKUP_HOUR_UTC must be an integer from 0 to 23.');
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function backupLoop(signal: AbortSignal) {
  const destination = process.env.BACKUP_DESTINATION;
  if (!destination)
    throw new Error(
      'Scheduled backups require BACKUP_DESTINATION set to the local or remote backup directory.',
    );
  const hour = Number(process.env.BACKUP_HOUR_UTC ?? 3);
  nextBackupTime(new Date(), hour);
  // An immediate first snapshot establishes whether the independent backup keys/storage work.
  while (!signal.aborted) {
    const nextRunAt = nextBackupTime(new Date(), hour).toISOString();
    await connection()`insert into host.settings(key,value) values('backupSchedule',${connection().json({ hourUtc: hour, nextRunAt })}) on conflict(key) do update set value=excluded.value`;
    let outcome: 'success' | 'failure' = 'failure';
    try {
      const result = await createBackup({
        databaseUrl: process.env.DATABASE_URL ?? '',
        keyFile: process.env.BACKUP_KEY_FILE ?? '',
        encryptionKey: process.env.ENCRYPTION_KEY ?? '',
        destination,
        kind: 'daily',
        signal,
      });
      outcome = result.retention === 'failed' ? 'failure' : 'success';
      console.log(
        JSON.stringify({ event: 'backup_completed', createdAt: result.metadata.createdAt }),
      );
    } catch {
      if (signal.aborted) {
        console.log(JSON.stringify({ event: 'backup_cancelled' }));
        break;
      }
      console.error(
        JSON.stringify({
          event: 'backup_failed',
          message:
            'Inspect the database, separate keys and backup destination. No incomplete archive was retained.',
        }),
      );
    }
    if (signal.aborted) break;
    const notification = await backupHeartbeat(outcome);
    console.log(JSON.stringify({ event: 'backup_notification', state: notification }));
    try {
      await connection()`insert into host.settings(key,value) values('backupNotification',${connection().json({ state: notification, updatedAt: new Date().toISOString() })}) on conflict(key) do update set value=excluded.value`;
    } catch {
      console.error(JSON.stringify({ event: 'backup_notification_status_unavailable' }));
    }
    try {
      await sleep(nextBackupTime(new Date(), hour).getTime() - Date.now(), undefined, {
        signal,
      });
    } catch {
      break;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (
      command === 'maintenance' &&
      ['on', 'off'].includes(process.argv[3]) &&
      process.argv.length === 4
    ) {
      if (process.argv[3] === 'off') await checkSchema();
      await setMaintenance(process.argv[3] === 'on');
      console.log(`Maintenance ${process.argv[3]}.`);
    } else if (command === 'verify-schema' && process.argv.length === 3) {
      await checkSchema();
      console.log('Installed composition and schema match this release.');
    } else if (command === 'worker-health' && process.argv.length === 3) {
      const [row] = await connection()`select value from host.settings where key='worker'`;
      if (operationalHealth({ worker: row?.value }).workerWarning) process.exitCode = 1;
    } else if (command === 'backup-loop' && process.argv.length === 3) {
      const controller = new AbortController();
      process.once('SIGTERM', () => controller.abort());
      process.once('SIGINT', () => controller.abort());
      await backupLoop(controller.signal);
    } else
      throw new Error(
        'Usage: pnpm exec tsx scripts/operations.ts maintenance on|off | verify-schema | worker-health | backup-loop',
      );
  } finally {
    await closeDatabase();
  }
}
