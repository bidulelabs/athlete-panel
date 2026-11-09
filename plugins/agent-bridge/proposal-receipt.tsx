'use client';
import { useState } from 'react';
import { CalendarDays, CheckCircle2, RotateCcw, X } from 'lucide-react';
import {
  Button,
  ErrorMessage,
  requestId,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';
import type { ProposalReceipt } from './proposal-dialog';

export function AppliedProposal({
  receipt,
  onDismiss,
}: {
  receipt: ProposalReceipt;
  onDismiss: () => void;
}) {
  const { request, navigate, setFrom } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  const [undone, setUndone] = useState(false);
  return (
    <section className="proposal-receipt" aria-label="Proposal result">
      <div className="proposal-receipt-heading">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div role="status">
          <strong>{undone ? 'Proposal undone' : 'Proposal applied'}</strong>
          <p>
            {undone
              ? 'All changes in this proposal were undone.'
              : `Saved ${receipt.count} changes: ${receipt.summary}.`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss proposal result"
          onClick={onDismiss}
        >
          <X size={18} />
        </Button>
      </div>
      <ErrorMessage error={action.error} />
      <div className="proposal-receipt-actions">
        <Button
          variant="outline"
          onClick={() => {
            if (receipt.from) setFrom(receipt.from);
            navigate('/calendar');
          }}
        >
          <CalendarDays size={16} />
          View calendar
        </Button>
        {!undone && (
          <Button
            variant="ghost"
            disabled={action.busy}
            onClick={async () => {
              if (
                await confirm(
                  'Undo this entire proposal? Undo will be refused if affected records have changed since.',
                )
              )
                void action.run(
                  () =>
                    request('agent-bridge', 'undo', {
                      id: receipt.id,
                      idempotencyKey: requestId(),
                    }),
                  () => setUndone(true),
                );
            }}
          >
            <RotateCcw size={16} />
            {action.busy ? 'Undoing…' : 'Undo proposal'}
          </Button>
        )}
      </div>
    </section>
  );
}
