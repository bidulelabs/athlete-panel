export function operationalHealth(values: Record<string, any>, now = Date.now()) {
  const age = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? now - Date.parse(value) : Infinity;
  const heartbeatAge = age(values.worker?.lastSeen);
  const failed = values.worker?.state === 'failed';
  const worker = heartbeatAge <= 90_000 ? failed ? 'Worker needs attention' : values.worker?.state === 'maintenance' ? 'Paused for maintenance' : 'Running' : values.worker?.lastSeen ? 'Worker is not responding' : 'Worker has not checked in';
  const attempt = values.backupAttempt;
  const backup = attempt?.state === 'failed' ? 'Last backup attempt failed'
    : attempt?.state === 'running' ? age(attempt.startedAt) > 3_600_000 ? 'Backup may be stalled' : 'Backup in progress'
    : !values.lastBackup?.completedAt ? values.backupSchedule ? 'Waiting for first successful backup' : 'Backups are not configured'
    : age(values.lastBackup.completedAt) > 26 * 3_600_000 ? 'Backup is overdue'
    : values.lastBackup.storage === 'remote-mount' && values.lastBackup.verifiedAt ? 'Verified backup on registered remote storage'
    : 'Archive available; off-host protection not verified';
  return { worker, backup, workerWarning: heartbeatAge > 90_000 || failed, backupWarning: !['Verified backup on registered remote storage', 'Backup in progress'].includes(backup) };
}
