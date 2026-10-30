'use client';
import type { ImportStream, ImportScope } from '@athlete-panel/contracts';
import { OnboardingConnection } from './onboarding-contribution';
export const contributions = { connection: OnboardingConnection };
import { Alert } from '@athlete-panel/ui';
import { useConfirm } from '@athlete-panel/ui';
import { Button, Input, NativeSelect } from '@athlete-panel/ui';
import { CoverageHistory } from './coverage-client';
import {
  activitySummary,
  connectionDetail,
  coverageSummary,
  recoverySummary,
  refreshRange,
  refreshState,
  syncTime,
} from './page-status';
import { GarminKeyForm } from './connection-client';
export { GarminKeyForm, GarminConnectionStatus } from './connection-client';

import { useEffect, useId, useState } from 'react';
import { ChevronRight, Pause, Play, RefreshCw, Unplug } from 'lucide-react';
import { AutomaticRecovery, ImportActivity } from './details-client';
import './page.css';
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
  const [details, setDetails] = useState<'recovery' | 'activity' | null>(null);

  const [coverageOpen, setCoverageOpen] = useState(false);
  const reasonId = useId();
  const syncReasonId = useId();
  const detailsId = useId();
  const [receipt, setReceipt] = useState<{
    id: string;
    status: string;
    label: string;
    previousCheckedAt?: string;
    from: string;
    to: string;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryStream, setRetryStream] = useState<ImportStream>();
  const [refreshScope, setRefreshScope] = useState<ImportScope>('both');
  const [rangeFrom, setRangeFrom] = useState(addDays(localDate(), -7));
  const [rangeTo, setRangeTo] = useState(localDate());
  const running = !!garmin.currentJob && ['running', 'queued'].includes(garmin.currentJob.status);
  const recentSyncActive = running && garmin.currentJob?.kind === 'garmin-recent';
  const syncDisabled = !garmin.connected || action.busy || recentSyncActive || garmin.paused;
  const syncReason = garmin.paused
    ? 'Resume imports to sync the latest data.'
    : recentSyncActive
      ? garmin.currentJob?.status === 'running'
        ? 'Sync in progress.'
        : 'Sync already queued.'
      : action.busy
        ? 'Wait for the current request to finish.'
        : null;
  const historyBusy = [garmin.currentJob, ...envelope.jobs].some(
    (job) => job?.kind === 'garmin-history' && ['queued', 'running', 'paused'].includes(job.status),
  );
  const refreshDisabled = !garmin.connected || garmin.paused || historyBusy || action.busy;
  const refreshReason = garmin.paused
    ? 'Resume imports to refresh a date range.'
    : historyBusy
      ? 'Available after the current history import finishes'
      : action.busy
        ? 'Wait for the current request to finish.'
        : null;
  const detail = connectionDetail(garmin, !workerHealth.workerWarning);
  const receiptStatus =
    receipt &&
    ((garmin.checkedAt && garmin.checkedAt !== receipt.previousCheckedAt
      ? ((garmin.currentJob?.id === receipt.id ? garmin.currentJob.status : undefined) ??
        envelope.jobs.find((job) => job.id === receipt.id)?.status)
      : undefined) ??
      receipt.status);
  function openRefresh(from?: string, to?: string, stream?: ImportStream) {
    setRetryStream(stream);
    setRefreshScope('both');
    if (from) setRangeFrom(from);
    if (to) setRangeTo(to);
    action.setError(null);
    setRetrying(true);
  }
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  return (
    <>
      <div className="garmin-page">
        <PageHeader
          title="Garmin import"
          description="Your activities and health data, in one place."
          actions={
            garmin.connected ? (
              <div className="garmin-import-actions">
                <div className="garmin-refresh-action">
                  <Button
                    disabled={syncDisabled}
                    aria-describedby={syncReason ? syncReasonId : undefined}
                    title="Import activities and health data from the latest seven days"
                    onClick={() => action.run(() => request('garmin', 'sync', { mode: 'recent' }))}
                  >
                    <RefreshCw size={16} />
                    Sync latest data
                  </Button>
                  {syncReason && <p id={syncReasonId}>{syncReason}</p>}
                </div>
                <div className="garmin-refresh-action">
                  <Button
                    variant="outline"
                    className="garmin-refresh-trigger"
                    disabled={refreshDisabled}
                    aria-describedby={refreshReason ? reasonId : undefined}
                    onClick={() => openRefresh()}
                  >
                    Refresh date range
                  </Button>
                  {refreshReason && <p id={reasonId}>{refreshReason}</p>}
                </div>
              </div>
            ) : (
              <Button onClick={() => setEditing(true)}>Connect Garmin</Button>
            )
          }
        />
        <ErrorMessage error={action.error} />
        {receipt && receiptStatus && (
          <Alert className="garmin-refresh-receipt" role="status">
            <span>
              {receipt.label} refresh {refreshState(receiptStatus)} ·{' '}
              {refreshRange(receipt.from, receipt.to)}
            </span>
            <Button variant="link" onClick={() => setDetails('activity')}>
              View progress
            </Button>
          </Alert>
        )}
        <section className="garmin-connection" aria-label="Connection and sync summary">
          <div className="garmin-summary">
            <div className="garmin-connection-line">
              <h2>
                {garmin.connected
                  ? garmin.paused
                    ? 'Imports paused'
                    : garmin.verified
                      ? 'Connected'
                      : 'Checking connection'
                  : 'Connect your Garmin account'}
              </h2>
              {garmin.connected && (
                <span className="garmin-last-sync">
                  <span aria-hidden="true">· </span>
                  {garmin.lastSync ? (
                    <time
                      dateTime={garmin.lastSync}
                      title={new Date(garmin.lastSync).toLocaleString('en-GB')}
                    >
                      Last synced {syncTime(garmin.lastSync)}
                    </time>
                  ) : (
                    'No completed sync yet'
                  )}
                </span>
              )}
            </div>
            {detail && <p role="status">{detail}</p>}
          </div>
          {garmin.connected && (
            <div className="garmin-connection-actions">
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() =>
                  action.run(() => request('garmin', 'pause', { paused: !garmin.paused }))
                }
              >
                {garmin.paused ? <Play size={15} /> : <Pause size={15} />}
                {garmin.paused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="outline" disabled={action.busy} onClick={() => setEditing(true)}>
                Replace API key
              </Button>
              <Button
                variant="destructive"
                disabled={action.busy}
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
          )}
        </section>
        {garmin.lastError && garmin.lastError !== detail && (
          <ErrorMessage error={garmin.lastError} />
        )}
        <div className="garmin-overview">
          <section className="garmin-policy" aria-label="Refresh policy">
            <h2>How Garmin updates</h2>
            <ul>
              <li>
                <strong>Recent data:</strong> The latest seven days refresh every hour.
              </li>
              <li>
                <strong>History:</strong> Earlier data and dates not yet checked are imported
                automatically.
              </li>
              <li>
                <strong>Older changes:</strong> Use <strong>Refresh date range</strong> for
                corrections or late uploads affecting previously checked dates older than seven
                days.
              </li>
            </ul>
          </section>
          <section className="garmin-details" aria-labelledby={detailsId}>
            <h2 id={detailsId}>Import details</h2>
            <div className="garmin-detail-list">
              {(
                [
                  ['activity', 'Import log', activitySummary(garmin)],
                  ['coverage', 'History coverage', coverageSummary(garmin)],
                  ['recovery', 'Automatic recovery', recoverySummary(garmin)],
                ] as const
              ).map(([id, label, description]) => (
                <Button
                  key={id}
                  variant="ghost"
                  className="garmin-detail-link"
                  onClick={() => (id === 'coverage' ? setCoverageOpen(true) : setDetails(id))}
                  aria-haspopup="dialog"
                  aria-label={label}
                  aria-describedby={`garmin-${id}-summary`}
                >
                  <span>
                    <strong>{label}</strong>
                    <span id={`garmin-${id}-summary`}>{description}</span>
                  </span>
                  <ChevronRight size={18} />
                </Button>
              ))}
            </div>
          </section>
        </div>
      </div>
      <Modal
        open={coverageOpen}
        onClose={() => setCoverageOpen(false)}
        title="History coverage"
        className="garmin-dialog garmin-coverage-dialog"
        wide
      >
        <div className="dialog-body">
          {coverageOpen && (
            <CoverageHistory
              checkedAt={garmin.checkedAt}
              disabled={refreshDisabled}
              onRetry={openRefresh}
            />
          )}
        </div>
      </Modal>
      <Modal
        open={details === 'recovery'}
        onClose={() => setDetails(null)}
        title="Automatic recovery"
        className="garmin-dialog"
        description="Initial history and periods that have never been scanned are imported automatically."
      >
        <div className="dialog-body">
          <AutomaticRecovery
            disabled={refreshDisabled}
            onImport={() => action.run(() => request('garmin', 'sync', { mode: 'full' }))}
            onCoverage={() => setCoverageOpen(true)}
          />
          <ErrorMessage error={action.error} />
        </div>
      </Modal>
      <Modal
        open={details === 'activity'}
        onClose={() => setDetails(null)}
        title="Import log"
        className="garmin-dialog"
        wide
        description="Recent imports and any delays or errors."
      >
        <div className="dialog-body">
          <ImportActivity />
          <ErrorMessage error={action.error} />
        </div>
      </Modal>
      <Modal
        open={retrying}
        onClose={() => setRetrying(false)}
        title={retryStream ? 'Retry this period' : 'Refresh date range'}
        description={
          retryStream
            ? `Refresh ${retryStream} for this period. The results will update when the import finishes.`
            : 'Refresh the selected data for this period. Existing records are updated without creating duplicates.'
        }
      >
        <form
          className="dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            setReceipt(null);
            void action.run(
              async () => {
                const result = await request('garmin', 'sync', {
                  mode: 'full',
                  from: rangeFrom,
                  to: rangeTo,
                  ...(retryStream ? { stream: retryStream } : { scope: refreshScope }),
                });
                const streamLabels = {
                  activities: 'Activities',
                  sleep: 'Sleep',
                  daily: 'Resting heart rate',
                  hrv: 'HRV',
                  steps: 'Steps',
                  stress: 'Stress',
                  bodyBattery: 'Body Battery',
                };
                setReceipt({
                  ...result,
                  previousCheckedAt: garmin.checkedAt,
                  from: rangeFrom,
                  to: rangeTo,
                  label: retryStream
                    ? streamLabels[retryStream]
                    : { activities: 'Activities', health: 'Health', both: 'Activities and health' }[
                        refreshScope
                      ],
                });
              },
              () => setRetrying(false),
            );
          }}
        >
          {!retryStream && (
            <Field label="Data to refresh">
              <NativeSelect
                value={refreshScope}
                onChange={(event) => setRefreshScope(event.target.value as ImportScope)}
              >
                <option value="activities">Activities</option>
                <option value="health">Health</option>
                <option value="both">Both</option>
              </NativeSelect>
            </Field>
          )}
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
            <SubmitButton busy={action.busy}>
              {retryStream ? 'Queue retry' : 'Queue refresh'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={garmin.connected ? 'Replace API key' : 'Connect Garmin'}
        description="Import activities and health data from Garmin. Your training plans aren’t sent to Garmin."
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
