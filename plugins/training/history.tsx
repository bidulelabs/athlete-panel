'use client';

import {
  operationContracts,
  responseError,
  type AuditEntry,
  type AuditSummary,
} from '@athlete-panel/contracts';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ErrorMessage,
  HistorySheet,
  requestId,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';
import { ChevronDown, History, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { historyFields, historyRecords, recordName } from './history-summary';
import './history.css';

function HistoryEntry({
  entry,
  busy,
  onUndo,
}: {
  entry: AuditSummary;
  busy: boolean;
  onUndo: (entry: AuditSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<AuditEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded || details) return;
    const controller = new AbortController();
    setError(null);
    void (async () => {
      const response = await fetch('/api/plugins/training/history-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(result, 'Could not load change details.'));
      const value = operationContracts.training['history-details'].output.parse(result);
      if (!controller.signal.aborted) setDetails(value);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not load change details.');
    });
    return () => controller.abort();
  }, [expanded, details, entry.id, retry]);
  const { data } = useWorkspace();
  const records = details ? historyRecords(details) : [];
  const units = data.profile?.units ?? 'metric';
  // Include historical plans so deleted or renamed plans still have useful context.
  const plans = [
    ...(details?.changes ?? []).flatMap((change) =>
      change.entity === 'plan' && (change.after ?? change.before)
        ? [change.after ?? change.before!]
        : [],
    ),
    ...data.plans,
  ];
  return (
    <li className="training-history-entry">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <h3>{entry.title}</h3>
        <div className="training-history-meta">
          <time dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: data.profile?.timezone,
            })}
          </time>
          <span>
            {entry.affectedCount} {entry.affectedCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="training-history-actions">
          {entry.affectedCount > 0 && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {expanded ? 'Hide details' : 'View details'}
                <ChevronDown size={15} className="training-history-chevron" />
              </Button>
            </CollapsibleTrigger>
          )}
          {entry.undoneAt ? (
            <Badge className="badge">Undone</Badge>
          ) : entry.undoable === false ? (
            <span className="muted-text">Undo unavailable</span>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onUndo(entry)}>
              <RotateCcw size={14} />
              Undo
            </Button>
          )}
        </div>
        <CollapsibleContent className="training-history-details">
          {!details && !error && <p role="status">Loading change details…</p>}
          {error && (
            <div>
              <ErrorMessage error={error} />
              <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
                Retry details
              </Button>
            </div>
          )}
          {records.map((record) => (
            <section key={`${record.entity}-${record.id}`} className="training-history-record">
              <h4>{recordName(record)}</h4>
              <p className="training-history-record-kind">
                {record.entity === 'health' ? 'Health record' : record.entity} ·{' '}
                {!record.before ? 'Added' : !record.after ? 'Deleted' : 'Updated'}
              </p>
              <dl>
                {historyFields(record, units, plans).map((field) => (
                  <div key={field.label}>
                    <dt>{field.label}</dt>
                    <dd>
                      {field.before === null || field.after === null ? (
                        'Updated'
                      ) : !record.before ? (
                        field.after
                      ) : !record.after ? (
                        field.before
                      ) : (
                        <>
                          <span className="training-history-before">
                            <span className="training-history-value-label">Before: </span>
                            {field.before}
                          </span>
                          <span>
                            <span className="training-history-value-label">After: </span>
                            {field.after}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

export function TrainingHistory() {
  const { envelope, request } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  async function undo(entry: AuditSummary) {
    if (
      await confirm(
        `Undo “${entry.title}”? This restores the entire change. If a later edit conflicts, nothing will be changed.`,
        'Undo change',
      )
    )
      void action.run(() =>
        request('training', 'undo', { id: entry.id, idempotencyKey: requestId() }),
      );
  }
  return (
    <HistorySheet
      title="Recent changes"
      description="Review edits across your training."
      entryCount={envelope.changes.length}
      className="training-history-sheet"
      onOpen={() => action.setError(null)}
      notice={action.error && <ErrorMessage error={action.error} />}
      trigger={
        <Button variant="outline">
          <History size={16} aria-hidden="true" />
          Recent changes
        </Button>
      }
    >
      {envelope.changes.length ? (
        <ol className="training-history-list" aria-label="Training change history">
          {envelope.changes.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} busy={action.busy} onUndo={undo} />
          ))}
        </ol>
      ) : (
        <div className="training-history-empty">
          <h3>No changes yet</h3>
          <p>Your training edits will appear here.</p>
        </div>
      )}
    </HistorySheet>
  );
}
