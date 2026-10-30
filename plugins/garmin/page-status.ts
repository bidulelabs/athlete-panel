import type { WorkspaceEnvelope } from '@athlete-panel/contracts';
import { connectionMessage } from './connection-status';

type GarminStatus = WorkspaceEnvelope['garmin'];

export function syncTime(value: string, now = new Date()): string {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short' });
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day.format(date) === day.format(now) ? 'today' : `on ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`} at ${time.format(date)}`;
}

export function refreshRange(from: string, to: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));
}

export function coverageSummary(value: GarminStatus): string {
  const counts = value.coverageSummary;
  if (!counts?.windows) return 'History has not been checked yet';
  // Categories can overlap (for example failed windows with rejected records).
  // Describe each count instead of adding them into a misleading total.
  const issues = [
    counts.failed && `${counts.failed} failed period${counts.failed === 1 ? '' : 's'}`,
    counts.unavailable &&
      `${counts.unavailable} unavailable period${counts.unavailable === 1 ? '' : 's'}`,
    counts.rejected &&
      `${counts.rejected} window${counts.rejected === 1 ? '' : 's'} with rejected records`,
  ].filter(Boolean);
  if (issues.length === 1 && counts.failed)
    return `${issues[0]} ${counts.failed === 1 ? 'needs' : 'need'} attention`;
  return issues.length ? issues.join(' · ') : 'No history errors reported';
}

export function recoverySummary(value: GarminStatus): string {
  if (!value.connected) return 'Connect Garmin to recover unscanned periods';
  if (value.paused) return 'Recovery paused';
  const recovery = value.recovery;
  if (!recovery) return 'Recovery status unavailable';
  if (recovery.catchup?.status === 'running') return 'Recovering unscanned periods';
  if (recovery.catchup?.status === 'queued') return 'Recovery import queued';
  if (recovery.catchup?.status === 'disabled') return 'Recovery imports disabled';
  if (recovery.catchup?.status === 'paused') return 'Recovery import paused';
  if (recovery.catchup?.status === 'failed' || recovery.retryStreams.length)
    return 'Recovery needs an explicit retry';
  return recovery.unscannedWindows ? 'Waiting to check older dates' : 'No recovery import running';
}

export function activitySummary(value: GarminStatus): string {
  const job = value.currentJob;
  if (job?.retrying)
    return job.nextRunAt ? `Retry scheduled ${syncTime(job.nextRunAt)}` : 'Waiting to retry';
  if (job?.status === 'running') return 'Import in progress';
  if (job?.status === 'queued') return 'Import queued';
  if (job?.status === 'failed') return 'An import failed — view details';
  if (job?.status === 'paused') return 'Import paused';
  if (job?.status === 'disabled') return 'Imports disabled';
  // lastSync is a successful sync timestamp, not the completion time of every job.
  if (value.lastSync) return `Last successful sync ${syncTime(value.lastSync)}`;
  if (job?.status === 'completed') return 'Import completed';
  if (job?.status === 'cancelled') return 'Last import cancelled';
  return 'No imports have run yet';
}

export function connectionDetail(value: GarminStatus, workerAvailable: boolean): string | null {
  if (!value.connected)
    return 'Use a Garmin Personal API key to import activities and health data.';
  if (
    ['credentials_rejected', 'account_mismatch', 'account_identity_unavailable'].includes(
      value.lastErrorCode ?? '',
    )
  )
    return connectionMessage(value, workerAvailable);
  if (value.paused) return 'Resume imports to continue.';
  if (value.currentJob?.retrying)
    return `${value.lastErrorCode === 'rate_limited' ? 'Garmin asked us to wait.' : 'Garmin is temporarily unavailable.'} ${activitySummary(value)}.`;
  if (!workerAvailable && ['queued', 'running'].includes(value.currentJob?.status ?? ''))
    return value.verified
      ? 'Imports are waiting for the background worker. Check Instance status on the Plugins page.'
      : 'Your key is saved. Connection checking will start when the background worker is available.';
  if (!value.verified) return 'Your key is saved. Waiting for Garmin to verify the connection.';
  if (
    value.currentJob &&
    ['queued', 'running', 'failed', 'paused', 'disabled'].includes(value.currentJob.status)
  )
    return activitySummary(value);
  if (
    value.coverageSummary?.failed ||
    value.coverageSummary?.unavailable ||
    value.coverageSummary?.rejected
  )
    return 'Some history needs attention. Open History coverage for details.';
  return null;
}

export function refreshState(status: string): string {
  return (
    (
      {
        queued: 'queued',
        running: 'in progress',
        completed: 'completed',
        paused: 'paused',
        disabled: 'waiting for imports to be enabled',
        failed: 'failed',
        cancelled: 'cancelled',
      } as Record<string, string>
    )[status] ?? 'accepted'
  );
}
