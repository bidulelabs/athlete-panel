'use client';

import type { AppleHealthStatus } from '@athlete-panel/contracts';
import {
  Button,
  dateLabel,
  ErrorMessage,
  PageHeader,
  useAction,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneSetup, appleHealthConnectionLabel } from './phone-setup';
import { AppleHealthOnboarding } from './onboarding-contribution';
import './page.css';

export const contributions = { connection: AppleHealthOnboarding };

function ConnectionSummary({ status, zone }: { status: AppleHealthStatus; zone?: string }) {
  return (
    <dl className="apple-summary">
      <div>
        <dt>Connection</dt>
        <dd>{appleHealthConnectionLabel(status)}</dd>
      </div>
      <div>
        <dt>Last workout upload</dt>
        <dd>
          {status.lastUploadAt ? (
            <time dateTime={status.lastUploadAt}>
              {new Date(status.lastUploadAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: zone,
              })}
            </time>
          ) : (
            'Waiting for workouts'
          )}
        </dd>
      </div>
      <div>
        <dt>Imported dates</dt>
        <dd>
          {status.importedFrom && status.importedTo
            ? `${dateLabel(status.importedFrom)} – ${dateLabel(status.importedTo)}`
            : 'No dates received yet'}
        </dd>
      </div>
    </dl>
  );
}

function ImportStatus({ status, zone }: { status: AppleHealthStatus; zone?: string }) {
  return (
    <section className="apple-health-section" aria-labelledby="apple-connection">
      <h2 id="apple-connection">Connection and sync</h2>
      <ConnectionSummary status={status} zone={zone} />
      <ErrorMessage error={status.error} />
      {status.lastBatch && (
        <p>
          Last batch · {status.lastBatch.imported} saved · {status.lastBatch.removed} removed ·{' '}
          {status.lastBatch.excluded} excluded
        </p>
      )}
      {status.lastBatch?.issueCount ? (
        <details>
          <summary>Issues in last batch ({status.lastBatch.issueCount})</summary>
          <ul>
            {status.lastBatch.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {status.unresolvedIssues.count > 0 && (
        <details>
          <summary>Unresolved workout issues ({status.unresolvedIssues.count})</summary>
          <ul>
            {status.unresolvedIssues.messages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          {status.unresolvedIssues.count > status.unresolvedIssues.messages.length && (
            <p>Showing the 10 most recent issues.</p>
          )}
        </details>
      )}
    </section>
  );
}

function RecordingSources({
  status,
  busy,
  notice,
  onSource,
}: {
  status: AppleHealthStatus;
  busy: boolean;
  notice: string;
  onSource: (name: string, excluded: boolean) => void;
}) {
  return (
    <section className="apple-health-section" aria-labelledby="apple-sources">
      <h2 id="apple-sources">Recording sources</h2>
      <p>Exclude a source to remove its workouts and any planned-session links from your totals.</p>
      {status.sources.length ? (
        <ul className="apple-source-list">
          {status.sources.map(({ name, excluded }) => (
            <li key={name}>
              <div>
                <strong>{name}</strong>
                <span>{excluded ? 'Excluded' : 'Included'}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label={`${excluded ? 'Include' : 'Exclude'} ${name}`}
                onClick={() => onSource(name, !excluded)}
              >
                {excluded ? 'Include' : 'Exclude'}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Sources appear after the iPhone sends workouts.</p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export default function AppleHealthPage({ data, request, refresh }: PluginPageProps) {
  const [status, setStatus] = useState<AppleHealthStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const action = useAction();
  const sequence = useRef(0);
  const acceptStatus = (next: AppleHealthStatus) => {
    sequence.current++;
    setStatus(next);
    setLoadError(null);
  };
  const fetchStatus = useCallback(async () => {
    const revision = ++sequence.current;
    try {
      const next = await request('apple-health', 'status', {});
      if (revision === sequence.current) {
        setStatus(next);
        setLoadError(null);
      }
    } catch (error) {
      if (revision === sequence.current)
        setLoadError(
          error instanceof Error ? error.message : 'Could not load Apple Health status.',
        );
    }
  }, [request]);

  useEffect(() => {
    void fetchStatus();
    return () => {
      sequence.current++;
    };
  }, [fetchStatus]);
  useEffect(() => {
    if (status?.lastUploadAt) void refresh();
  }, [status?.lastUploadAt, refresh]);
  useEffect(() => {
    if (!status?.connected) return;
    const timer = setInterval(() => {
      if (!document.hidden && !action.busy) void fetchStatus();
    }, 10000);
    return () => clearInterval(timer);
  }, [status?.connected, action.busy, fetchStatus]);

  return (
    <div className="apple-health-page">
      <PageHeader
        title="Apple Health"
        description="Import Apple Watch workouts from Sync for Health on your iPhone."
        actions={
          <Button variant="outline" disabled={action.busy} onClick={() => void fetchStatus()}>
            <RefreshCw size={15} /> Refresh status
          </Button>
        }
      />
      <ErrorMessage error={loadError || action.error} />
      {!status && !loadError && <p role="status">Loading Apple Health status…</p>}
      {status && (
        <>
          <ImportStatus status={status} zone={data.profile?.timezone} />
          <section className="apple-health-section" aria-labelledby="apple-setup">
            <h2 id="apple-setup">Set up the iPhone</h2>
            <PhoneSetup
              status={status}
              token={token}
              busy={action.busy}
              onIssue={() =>
                action.run(async () => {
                  const result = await request('apple-health', 'issue-token', {});
                  setToken(result.token);
                  acceptStatus(result.status);
                  setNotice('');
                })
              }
              onDisconnect={() =>
                action.run(async () => {
                  acceptStatus(await request('apple-health', 'disconnect', {}));
                  setToken(null);
                  setNotice('Disconnected. Imported workouts are still in your history.');
                })
              }
            />
          </section>
          <RecordingSources
            status={status}
            busy={action.busy}
            notice={notice}
            onSource={(name, excluded) =>
              action.run(async () => {
                acceptStatus(await request('apple-health', 'set-source', { name, excluded }));
                setNotice(
                  excluded
                    ? 'Source excluded. Any previous links are visible in Recent changes.'
                    : 'Use Resend all history on the iPhone to restore older workouts for this source.',
                );
              })
            }
          />
        </>
      )}
    </div>
  );
}
