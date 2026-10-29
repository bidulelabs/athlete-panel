'use client';

import type { AuditEntry } from '@athlete-panel/contracts';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ErrorMessage,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  requestId,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';
import { ChevronDown, History, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { historyFields, historyRecords, historyTitle, recordName } from './history-summary';
import './history.css';

function HistoryEntry({
  entry,
  busy,
  onUndo,
}: {
  entry: AuditEntry;
  busy: boolean;
  onUndo: (entry: AuditEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useWorkspace();
  const records = historyRecords(entry);
  const units = data.profile?.units ?? 'metric';
  // Include historical plans so deleted or renamed plans still have useful context.
  const plans = [
    ...entry.changes.flatMap((change) =>
      change.entity === 'plan' && (change.after ?? change.before)
        ? [change.after ?? change.before!]
        : [],
    ),
    ...data.plans,
  ];
  return (
    <li className="training-history-entry">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <h3>{historyTitle(entry)}</h3>
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
            {records.length} {records.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="training-history-actions">
          {records.length > 0 && (
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
  const [open, setOpen] = useState(false);
  const confirming = () =>
    Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'));
  async function undo(entry: AuditEntry) {
    if (
      await confirm(
        `Undo “${historyTitle(entry)}”? This restores the entire change. If a later edit conflicts, nothing will be changed.`,
        'Undo change',
      )
    )
      void action.run(() =>
        request('training', 'undo', { id: entry.id, idempotencyKey: requestId() }),
      );
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (confirming()) return;
        if (next) action.setError(null);
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline">
          <History size={16} />
          Recent changes
        </Button>
      </SheetTrigger>
      <SheetContent
        className="training-history-sheet"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (confirming()) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (confirming()) event.preventDefault();
        }}
      >
        <header className="training-history-header">
          <div>
            <SheetTitle>Recent changes</SheetTitle>
            <SheetDescription>
              {envelope.changes.length === 50
                ? 'Latest 50 changes across your training.'
                : 'Review edits across your training.'}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close recent changes">
              <X size={20} />
            </Button>
          </SheetClose>
        </header>
        {action.error && (
          <div className="training-history-error">
            <ErrorMessage error={action.error} />
          </div>
        )}
        <div className="training-history-scroll">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
