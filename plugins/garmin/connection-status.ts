import type { GarminConnection } from '../../packages/contracts/src/garmin-connection';

export function connectionMessage(value: GarminConnection, workerAvailable = true): string {
  if (!value.connected)
    return "Garmin isn't connected. You can connect later from Garmin in the sidebar.";
  if (value.lastErrorCode === 'credentials_rejected')
    return "Garmin couldn't accept this key. Create or check your Personal API key, then try again.";
  if (value.lastErrorCode === 'account_mismatch')
    return 'This instance is already linked to another Garmin account. Use a key for the same account.';
  if (value.paused) return 'Garmin import is paused. You can resume it from Garmin in the sidebar.';
  if (value.currentJob?.retrying)
    return value.lastErrorCode === 'rate_limited'
      ? "Garmin asked us to wait. We'll retry automatically."
      : "Garmin is temporarily unavailable. We'll retry automatically.";
  if (!value.verified && value.lastErrorCode === 'account_identity_unavailable')
    return "We couldn't verify which Garmin account this key belongs to. No data has been imported from this attempt.";
  if (
    value.verified &&
    (value.lastError || value.coverageSummary?.failed || value.coverageSummary?.unavailable)
  )
    return 'Garmin connected. Some history needs attention.';
  if (value.lastError) return value.lastError;
  if (
    !workerAvailable &&
    value.currentJob &&
    ['queued', 'running'].includes(value.currentJob.status)
  )
    return value.verified
      ? 'Garmin connected. Imports are waiting for the background worker.'
      : 'Your key is saved. Connection checking will start when the background worker is available.';
  if (!value.verified) return 'Checking your Garmin connection…';
  if (value.historyStatus === 'completed') return 'Garmin connected. Latest history scan finished.';
  if (value.currentJob && ['queued', 'running'].includes(value.currentJob.status))
    return 'Garmin connected. Your data is importing in the background.';
  return 'Garmin connected. Ready to sync; historical completeness has not been confirmed.';
}
export function canRetryConnection(value: GarminConnection) {
  return value.connected && !value.paused && value.currentJob?.status === 'failed';
}
