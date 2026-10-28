'use client';
import type { ImportStream } from '@athlete-panel/contracts';
import { OnboardingConnection } from './onboarding-contribution';
export const contributions = { connection: OnboardingConnection };
import { Alert } from '@athlete-panel/ui';
import { useConfirm } from '@athlete-panel/ui';
import { Button, Badge, Input } from '@athlete-panel/ui';
import { CoverageHistory } from './coverage-client';
import { connectionMessage } from './connection-status';
import { GarminKeyForm } from './connection-client';
export { GarminKeyForm, GarminConnectionStatus } from './connection-client';

import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Pause, Play, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import {
  addDays,
  operationalHealth,
  ErrorMessage,
  Field,
  localDate,
  Modal,
  PageHeader,
  SubmitButton,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';

export default function GarminPage() {
  const confirm = useConfirm();
  const { envelope, request, refresh } = useWorkspace();
  const garmin = envelope.garmin;
  const action = useAction();
  const workerHealth = operationalHealth(
    Object.fromEntries((envelope.operational ?? []).map((row) => [row.key, row.value])),
  );
  const [editing, setEditing] = useState(false);

  const [retrying, setRetrying] = useState(false);
  const [retryStream, setRetryStream] = useState<ImportStream>();
  const [rangeFrom, setRangeFrom] = useState(addDays(localDate(), -7));
  const [rangeTo, setRangeTo] = useState(localDate());
  const running = !!garmin.currentJob && ['running', 'queued'].includes(garmin.currentJob.status);
  const recentSyncActive = running && garmin.currentJob?.kind === 'garmin-recent';
  const historyBusy = envelope.jobs.some(
    (job) => job.kind === 'garmin-history' && ['queued', 'running', 'paused'].includes(job.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  return (
    <>
      <PageHeader
        eyebrow="CONNECTED DATA"
        title="Garmin import"
        description="Bring your activities and health history into your private workspace."
        actions={
          garmin.connected && (
            <Button
              variant="default"
              className="button primary"
              disabled={action.busy || recentSyncActive || garmin.paused}
              onClick={() => action.run(() => request('garmin', 'sync', { mode: 'recent' }))}
            >
              <RefreshCw size={16} className={recentSyncActive ? 'spin' : ''} />
              {recentSyncActive ? 'Sync in progress' : 'Sync now'}
            </Button>
          )
        }
      />
      <ErrorMessage error={action.error} />
      {garmin.connected && running && workerHealth.workerWarning && (
        <Alert className="callout" role="status">
          {workerHealth.worker}. Imports are waiting for a worker. Check Instance status on the
          Plugins page.
        </Alert>
      )}
      <section className="connection-panel">
        <div className="connection-logo">
          <Activity size={29} />
        </div>
        <div className="connection-copy">
          <div className="eyebrow">GARMIN CONNECT PERSONAL API</div>
          <h2>
            {garmin.connected
              ? garmin.paused
                ? 'Import paused'
                : garmin.verified
                  ? 'Your Garmin is connected'
                  : 'Verifying your Garmin connection'
              : 'Connect your Garmin account'}
          </h2>
          <p>
            {garmin.connected
              ? 'Activities and health records stay here, even when Garmin is unavailable.'
              : 'Use your personal API key to import activity and health data. Your key is stored on this server.'}
          </p>
          <div className="connection-details">
            <span className={`status-dot ${garmin.connected && !garmin.paused ? '' : 'muted'}`} />
            {connectionMessage(garmin, !workerHealth.workerWarning)}
            {garmin.lastSync && (
              <>
                <span className="separator-dot">·</span>
                <span>Last sync {new Date(garmin.lastSync).toLocaleString('en-GB')}</span>
              </>
            )}
          </div>
        </div>
        <Button variant="outline" className="button" onClick={() => setEditing(true)}>
          {garmin.connected ? 'Replace API key' : 'Connect Garmin'}
          <ArrowUpRight size={16} />
        </Button>
      </section>
      {garmin.lastError && <ErrorMessage error={garmin.lastError} />}
      <div className="settings-layout">
        <section className="settings-section">
          <h2>Import settings</h2>
          <div className="setting-line">
            <div>
              <strong>Historical import</strong>
              <p>
                All available activity and health history is checked automatically. Older records
                may take time to appear.
              </p>
            </div>
            {garmin.connected && (
              <Button
                variant="outline"
                className="button"
                disabled={action.busy || historyBusy || garmin.paused}
                onClick={() => action.run(() => request('garmin', 'sync', { mode: 'full' }))}
              >
                Import Garmin history
              </Button>
            )}
          </div>
          <div className="setting-line">
            <div>
              <strong>Scheduled import</strong>
              <p>
                Check for new data every hour while the background worker is running. Recent sync
                rechecks the last seven days.
              </p>
            </div>
            <Button
              variant="outline"
              className="button"
              disabled={!garmin.connected || action.busy}
              onClick={() =>
                action.run(() => request('garmin', 'pause', { paused: !garmin.paused }))
              }
            >
              {garmin.paused ? <Play size={15} /> : <Pause size={15} />}
              {garmin.paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
          <div className="setting-line">
            <div>
              <strong>Disconnect Garmin</strong>
              <p>Remove credentials. Your imported history stays available.</p>
            </div>
            <Button
              variant="destructive"
              className="button danger-outline"
              disabled={!garmin.connected || action.busy}
              onClick={async () => {
                if (
                  await confirm(
                    'Remove your Garmin credentials? Imported activities and health records will be kept.',
                  )
                )
                  void action.run(() => request('garmin', 'disconnect'));
              }}
            >
              <Unplug size={15} />
              Disconnect
            </Button>
          </div>
        </section>
        <aside className="context-panel">
          <ShieldCheck size={22} />
          <h3>Import only</h3>
          <p>Your training plans and workouts are never sent to Garmin.</p>
          <a
            href="https://developer.garmin.com/gc-developer-program/personal/personal-api/"
            target="_blank"
            rel="noreferrer"
          >
            Get a personal API key <ArrowUpRight size={14} />
          </a>
        </aside>
      </div>
      <CoverageHistory
        checkedAt={garmin.checkedAt}
        disabled={!garmin.connected || garmin.paused || historyBusy || action.busy}
        onRetry={(from, to, stream) => {
          setRetryStream(stream);
          if (from) setRangeFrom(from);
          if (to) setRangeTo(to);
          setRetrying(true);
        }}
      />
      {garmin.recovery && garmin.connected && (
        <section className="section-block" aria-label="Automatic recovery">
          <h2>Automatic recovery</h2>
          <p>
            {garmin.recovery.unscannedWindows} unscanned windows. Recent data is checked hourly;
            missing periods are recovered before older history is revisited.
          </p>
          <dl>
            <div className="setting-line">
              <dt>Gap recovery</dt>
              <dd>
                {garmin.recovery.catchup
                  ? `${garmin.recovery.catchup.status} · ${garmin.recovery.catchup.stream ?? 'Checking checkpoint'} · ${garmin.recovery.catchup.from ?? 'Available history'} – ${garmin.recovery.catchup.to ?? '—'}`
                  : 'Waiting for eligible work'}
              </dd>
            </div>
            <div className="setting-line">
              <dt>Historical reconciliation</dt>
              <dd>
                {garmin.recovery.reconciliation
                  ? `${garmin.recovery.reconciliation.status} · ${garmin.recovery.reconciliation.stream ?? 'Checking checkpoint'} · ${garmin.recovery.reconciliation.from ?? 'Available history'} – ${garmin.recovery.reconciliation.to ?? '—'}`
                  : 'Waiting for initial imports and recovery'}
              </dd>
            </div>
          </dl>
          <p className="muted-text">
            All supported history is revisited gradually, at most one step every five minutes.{' '}
            {garmin.recovery.nextReconcileAt
              ? `Next eligible step: ${new Date(garmin.recovery.nextReconcileAt).toLocaleString()}.`
              : ''}{' '}
            Pauses and provider backoff may delay it.
          </p>
          {!!garmin.recovery.retryStreams.length && (
            <Alert role="status">
              Recovery needs an explicit retry for: {garmin.recovery.retryStreams.join(', ')}. Open
              Failed windows to retry the affected period.
            </Alert>
          )}
        </section>
      )}
      <section className="section-block">
        <div className="section-heading">
          <h2>Import activity</h2>
          <span className="muted-text">Local background jobs</span>
        </div>
        {garmin.currentJob && (
          <p role="status">
            Current import: {garmin.currentJob.status} · {garmin.currentJob.progress}
            {garmin.currentJob.retrying && garmin.currentJob.nextRunAt
              ? ` · Retrying at ${new Date(garmin.currentJob.nextRunAt).toLocaleString()}`
              : ''}
          </p>
        )}
        {envelope.jobs.filter((job) => String(job.kind).startsWith('garmin-')).length ? (
          <div className="data-table">
            <div className="data-table-header">
              <span>Job</span>
              <span>Status</span>
              <span>Progress</span>
            </div>
            {envelope.jobs
              .filter((job) => String(job.kind).startsWith('garmin-'))
              .slice(0, 12)
              .map((job) => (
                <div className="data-table-row" key={job.id}>
                  <span>{String(job.kind).replaceAll('.', ' · ')}</span>
                  <Badge className="badge">{job.status}</Badge>
                  <span>
                    {(job.error
                      ? `${job.error}${job.status === 'queued' && job.nextRunAt ? ` Retrying at ${new Date(job.nextRunAt).toLocaleString('en-GB')}.` : ''}`
                      : '') ||
                      (typeof job.progress === 'number'
                        ? `${Math.round(job.progress)}%`
                        : typeof job.progress === 'string'
                          ? job.progress
                          : '—')}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <div className="quiet-empty">No imports have run yet.</div>
        )}
      </section>
      <Modal
        open={retrying}
        onClose={() => setRetrying(false)}
        title="Retry a date range"
        description={
          retryStream
            ? `Request ${retryStream} records for this period again. Resolved rejection diagnostics are replaced after the scan completes.`
            : 'Request activities and health history again. Existing records are updated without creating duplicates.'
        }
      >
        <form
          className="dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              () =>
                request('garmin', 'sync', {
                  mode: 'full',
                  from: rangeFrom,
                  to: rangeTo,
                  ...(retryStream ? { stream: retryStream } : {}),
                }),
              () => setRetrying(false),
            );
          }}
        >
          <div className="form-row">
            <Field label="From date">
              <Input
                required
                type="date"
                max={rangeTo}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(event.target.value)}
              />
            </Field>
            <Field label="Through date">
              <Input
                required
                type="date"
                min={rangeFrom}
                max={localDate()}
                value={rangeTo}
                onChange={(event) => setRangeTo(event.target.value)}
              />
            </Field>
          </div>
          <ErrorMessage error={action.error} />
          <div className="dialog-actions">
            <Button
              variant="outline"
              type="button"
              className="button"
              onClick={() => setRetrying(false)}
            >
              Cancel
            </Button>
            <SubmitButton busy={action.busy}>Queue reimport</SubmitButton>
          </div>
        </form>
      </Modal>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={garmin.connected ? 'Update Garmin connection' : 'Connect Garmin'}
        description="Your personal API key is sent only to this server and Garmin."
      >
        <div className="dialog-body">
          <p className="muted-text">
            All available history is imported automatically. No start date is needed.
          </p>
          <GarminKeyForm
            request={request}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
            submitLabel="Save connection"
          />
        </div>
      </Modal>
    </>
  );
}
