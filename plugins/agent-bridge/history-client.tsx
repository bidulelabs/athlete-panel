'use client';
import { History, RotateCcw } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  HistorySheet,
  requestId,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';

export function AgentHistory() {
  const { envelope, request } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  return (
    <HistorySheet
      title="Change history"
      description="Recent changes across your training."
      className="agent-history-sheet"
      onOpen={() => action.setError(null)}
      notice={action.error && <ErrorMessage error={action.error} />}
      trigger={
        <Button variant="ghost">
          <History size={16} aria-hidden="true" />
          Change history
        </Button>
      }
    >
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
    </HistorySheet>
  );
}
