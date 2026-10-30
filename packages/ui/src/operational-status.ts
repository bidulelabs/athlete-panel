import { operationalValuesSchema } from '@athlete-panel/contracts';
export function operationalHealth(input: unknown, now = Date.now()) {
  const parsed = operationalValuesSchema.safeParse(input);
  const values = parsed.success ? parsed.data : {};
  const age = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? now - Date.parse(value)
      : Infinity;
  const heartbeatAge = age(values.worker?.lastSeen);
  const failed = values.worker?.state === 'failed';
  const degraded = values.worker?.state === 'degraded';
  const worker =
    heartbeatAge <= 90_000
      ? failed
        ? 'Worker needs attention'
        : degraded
          ? 'Running — a plugin scheduler needs attention'
          : values.worker?.state === 'maintenance'
            ? 'Paused for maintenance'
            : 'Running'
      : values.worker?.lastSeen
        ? 'Worker is not responding'
        : 'Worker has not checked in';
  const attempt = values.backupAttempt;
  const verifiedLocal = 'Local backup verified; off-server copy not configured';
  const backup =
    attempt?.state === 'failed'
      ? 'Last backup attempt failed'
      : attempt?.state === 'running'
        ? age(attempt.startedAt) > 3_600_000
          ? 'Backup may be stalled'
          : 'Backup in progress'
        : !values.lastBackup?.completedAt
          ? values.backupSchedule
            ? 'Waiting for first successful backup'
            : 'Backups are not configured'
          : age(values.lastBackup.completedAt) > 26 * 3_600_000
            ? 'Backup is overdue'
            : values.lastBackup.storage === 'remote-mount' && values.lastBackup.verifiedAt
              ? 'Verified backup on registered remote storage'
              : values.lastBackup.storage === 'local' && values.lastBackup.verifiedAt
                ? verifiedLocal
                : 'Archive available; off-host protection not verified';
  return {
    worker,
    backup,
    backupInfo:
      backup === verifiedLocal
        ? 'Local backups do not protect against losing this server. A successful backup still needs a restore rehearsal.'
        : null,
    workerWarning: heartbeatAge > 90_000 || failed || degraded,
    backupWarning: ![
      'Verified backup on registered remote storage',
      verifiedLocal,
      'Backup in progress',
    ].includes(backup),
  };
}
