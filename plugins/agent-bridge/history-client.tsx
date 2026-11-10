'use client';
import { useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
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

export function AgentHistory() {
  const { envelope, request } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const confirming = () =>
    Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'));
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (confirming()) return;
        if (value) action.setError(null);
        setOpen(value);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost">
          <History size={16} aria-hidden="true" />
          Change history
        </Button>
      </SheetTrigger>
      <SheetContent
        className="agent-history-sheet"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (confirming()) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (confirming()) event.preventDefault();
        }}
      >
        <header className="agent-history-header">
          <div>
            <SheetTitle>Change history</SheetTitle>
            <SheetDescription>
              {envelope.changes.length === 50
                ? 'Latest 50 changes across your training.'
                : 'Changes across your training.'}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close change history">
              <X size={20} />
            </Button>
          </SheetClose>
        </header>
        <div className="agent-history-scroll">
          <ErrorMessage error={action.error} />
          {envelope.changes.length ? (
            envelope.changes.map((change) => (
              <div className="agent-history-row" key={change.id}>
                <strong>{change.title || change.summary || 'Training data updated'}</strong>
                <p>
                  {change.affectedCount} change{change.affectedCount === 1 ? '' : 's'} ·{' '}
                  {new Date(change.createdAt).toLocaleString('en-GB')}
                </p>
                <div className="agent-row-actions">
                  <Badge className="badge">{change.undoneAt ? 'Undone' : 'Applied'}</Badge>
                  <Button
                    variant="outline"
                    disabled={action.busy || Boolean(change.undoneAt) || change.undoable === false}
                    onClick={async () => {
                      if (
                        await confirm(
                          'Undo this change set? Undo will be refused if affected records have changed since.',
                          'Undo change',
                        )
                      )
                        void action.run(() =>
                          request('agent-bridge', 'undo', {
                            id: change.id,
                            idempotencyKey: requestId(),
                          }),
                        );
                    }}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    Undo
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState icon={<History size={26} />} title="No changes yet">
              Applied training changes will appear here.
            </EmptyState>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
