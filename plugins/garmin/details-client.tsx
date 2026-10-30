'use client';

import { Alert, Badge, Button, useWorkspace } from '@athlete-panel/ui';

export function importLabel(kind: string) {
  return (
    {
      'garmin-recent': 'Recent sync',
      'garmin-history': 'History import',
      'garmin-catchup': 'Unscanned periods',
      'garmin-reconcile': 'Retired history rescan',
    }[kind] ?? kind
  );
}

export function AutomaticRecovery({
  disabled,
  onImport,
  onCoverage,
}: {
  disabled: boolean;
  onImport: () => void;
  onCoverage: () => void;
}) {
  const { envelope } = useWorkspace();
  const { connected, paused, recovery } = envelope.garmin;
  return (
    <div className="garmin-recovery">
      {!connected && <p>Connect Garmin to import history and recover unscanned periods.</p>}
      {connected && paused && <p>Recovery is paused. Resume imports from the Garmin page.</p>}
      {connected && recovery && (
        <>
          <p>
            {recovery.unscannedWindows} unscanned windows. These are periods without a completed
            scan.
          </p>
          <dl className="garmin-sync-summary">
            <div>
              <dt>Recovery status</dt>
              <dd>
                {recovery.catchup
                  ? `${recovery.catchup.status} · ${recovery.catchup.stream ?? 'Checking progress'} · ${recovery.catchup.from ?? 'Available history'} – ${recovery.catchup.to ?? '—'}`
                  : 'No recovery import queued'}
              </dd>
            </div>
          </dl>
          {!!recovery.retryStreams.length && (
            <Alert role="status">
              A retry is needed for: {recovery.retryStreams.join(', ')}. Open History coverage and
              choose Failed windows to retry the affected period.
            </Alert>
          )}
        </>
      )}
      <p>
        Already scanned history is not checked again automatically. Pauses and Garmin request limits
        can delay imports.
      </p>
      <div className="garmin-dialog-toolbar">
        <Button variant="outline" onClick={onCoverage}>
          History coverage
        </Button>
        {connected && (
          <Button variant="outline" disabled={disabled} onClick={onImport}>
            Import Garmin history
          </Button>
        )}
      </div>
    </div>
  );
}

export function ImportActivity() {
  const { envelope } = useWorkspace();
  const current = envelope.garmin.currentJob;
  const jobs = envelope.jobs.filter((job) => String(job.kind).startsWith('garmin-')).slice(0, 12);
  return (
    <>
      {current && (
        <p className="garmin-current-import" role="status">
          {importLabel(current.kind)}: {current.status}
          {current.progress ? ` · ${current.progress}` : ''}
          {current.retrying && current.nextRunAt
            ? ` · Retrying at ${new Date(current.nextRunAt).toLocaleString('en-GB')}`
            : ''}
        </p>
      )}
      {jobs.length ? (
        <ul className="garmin-import-list" aria-label="Recent imports">
          {jobs.map((job) => (
            <li key={job.id}>
              <div>
                <strong>{importLabel(String(job.kind))}</strong>
                <Badge>{job.status}</Badge>
              </div>
              <p>
                {job.error ||
                  (typeof job.progress === 'number'
                    ? `${Math.round(job.progress)}%`
                    : typeof job.progress === 'string' && job.progress
                      ? job.progress
                      : 'No progress recorded')}
                {job.status === 'queued' && job.error && job.nextRunAt
                  ? ` · Retrying at ${new Date(job.nextRunAt).toLocaleString('en-GB')}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet-empty">No imports have run yet.</p>
      )}
    </>
  );
}
