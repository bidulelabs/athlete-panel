'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ErrorMessage,
  Modal,
  dateLabel,
  requestId,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import {
  proposalReviewSchema,
  type ProposalReview,
  type ProposalSummary,
  type ProposalDetails,
} from '@athlete-panel/contracts';
import { summarizeProposal, planTitlesById } from './proposal-weeks';
import { ReviewChange } from './proposal-changes';
import { ProposalBrowser } from './proposal-browser';
import { changeAction, describeTypes } from './proposal-presentation';
export type ProposalReceipt = { id: string; summary: string; from?: string; count: number };
export function ProposalLoader({
  proposal,
  onClose,
  onApplied,
}: {
  proposal: ProposalSummary;
  onClose: () => void;
  onApplied: (receipt: ProposalReceipt) => void;
}) {
  const { request } = useWorkspace();
  const [details, setDetails] = useState<ProposalDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void request('agent-bridge', 'details', { id: proposal.id })
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [proposal.id, request, retry]);
  return (
    <Modal
      open
      onClose={onClose}
      title="Review proposed changes"
      wide
      className="proposal-review-dialog"
      focusHeading
    >
      {details ? (
        <ProposalDialog proposal={details} onClose={onClose} onApplied={onApplied} />
      ) : (
        <div className="dialog-body">
          {!error && <p role="status">Loading proposed edits…</p>}
          <ErrorMessage error={error} />
          {error && <Button onClick={() => setRetry((v) => v + 1)}>Retry details</Button>}
        </div>
      )}
    </Modal>
  );
}

function ProposalDialog({
  proposal,
  onClose,
  onApplied,
}: {
  proposal: ProposalDetails;
  onClose: () => void;
  onApplied: (receipt: ProposalReceipt) => void;
}) {
  const { request, data } = useWorkspace();
  const planTitles = planTitlesById(data.plans, proposal.changes);
  const action = useAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const [idempotencyKey] = useState(requestId);
  const [review, setReview] = useState<ProposalReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const pending = proposal.status === 'pending';
  const overview = summarizeProposal(proposal.changes);
  const canApply =
    pending && (review?.applicability === 'ready' || review?.applicability === 'review-required');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setAcknowledged(false);
    setReview(null);
    setReviewError(null);
    if (!pending) return;
    void (async () => {
      try {
        const response = await fetch('/api/plugins/agent-bridge/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: proposal.id, digest: proposal.digest }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Proposal review could not load. Try again.');
        const result = proposalReviewSchema.parse(await response.json());
        if (active) setReview(result);
      } catch (error) {
        if (active)
          setReviewError(
            error instanceof Error ? error.message : 'Proposal review could not load.',
          );
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [proposal.id, proposal.digest, pending, reviewVersion]);
  return (
    <>
      <div
        className="dialog-body proposal-review-body"
        tabIndex={0}
        role="region"
        aria-label="Proposal content"
      >
        <section className="proposal-overview" aria-label="Proposal overview">
          {proposal.summary && <p className="proposal-summary">{proposal.summary}</p>}
          {overview.from && (
            <p className="proposal-overview-dates">
              {dateLabel(overview.from, { day: 'numeric', month: 'short', year: 'numeric' })}
              {overview.to !== overview.from && (
                <>
                  {' '}
                  – {dateLabel(overview.to!, { day: 'numeric', month: 'short', year: 'numeric' })}
                </>
              )}
            </p>
          )}
          <dl className="proposal-outcomes">
            {(['create', 'update', 'delete'] as const).map((action) => {
              const changes = proposal.changes.filter((change) => changeAction(change) === action);
              return (
                changes.length > 0 && (
                  <div key={action} className={action === 'delete' ? 'proposal-deletions' : ''}>
                    <dt>{{ create: 'Add', update: 'Update', delete: 'Delete' }[action]}</dt>
                    <dd>{describeTypes(changes)}</dd>
                  </div>
                )
              );
            })}
          </dl>
          {review && (
            <p className="proposal-expiration">
              Apply before{' '}
              {new Date(review.expiresAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}
        </section>
        {!pending && <Badge className="badge">{proposal.status}</Badge>}
        {proposal.warnings?.map((warning, index) => (
          <Alert role="status" className="callout" key={index}>
            {typeof warning === 'string' ? warning : (warning.message ?? JSON.stringify(warning))}
          </Alert>
        ))}
        {!!review?.contextChanges.length && (
          <section className="proposal-context" aria-label="Changed context">
            <h3>Already changed on your calendar</h3>
            <p>
              The agent hadn’t seen these changes. They are already saved, separate from the
              proposed edits below.
            </p>
            <details>
              <summary>
                {review.contextChanges.length} change{review.contextChanges.length === 1 ? '' : 's'}{' '}
                since the agent read your data
              </summary>
              {review.contextChanges.map((change, index) => (
                <ReviewChange
                  change={change}
                  planTitles={planTitles}
                  caption="When the agent read your data and now"
                  context
                  key={index}
                />
              ))}
            </details>
          </section>
        )}
        <section aria-label="Proposed edits">
          <ProposalBrowser
            changes={proposal.changes}
            planTitles={planTitles}
            onFilterChange={setFiltered}
          />
        </section>
      </div>
      <div className="proposal-review-footer">
        {pending && (reviewError || !review || review.applicability !== 'ready') && (
          <div className="proposal-review-state" role="status">
            <strong>
              {reviewError
                ? 'Review unavailable'
                : !review
                  ? 'Checking proposal and current context…'
                  : !canApply
                    ? 'Blocked'
                    : 'Needs review · calendar context changed'}
            </strong>
            {review?.conflicts.map((conflict, index) => (
              <p key={`${conflict.code}:${index}`}>{conflict.message}</p>
            ))}
            {reviewError && (
              <>
                <p>{reviewError}</p>
                <Button variant="outline" onClick={() => setReviewVersion((value) => value + 1)}>
                  Retry review
                </Button>
              </>
            )}
          </div>
        )}
        {canApply && (
          <label className="checkbox-row">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            {review?.applicability === 'review-required'
              ? 'I have reviewed the changed context and still want to apply these exact edits.'
              : `I have reviewed all ${proposal.changes.length} change${proposal.changes.length === 1 ? '' : 's'} and want to apply ${proposal.changes.length === 1 ? 'it' : 'them'}.`}
          </label>
        )}
        <ErrorMessage error={action.error} />
        {pending && filtered && (
          <p className="proposal-apply-scope">
            Apply includes all {proposal.changes.length} changes, including those hidden by filters.
          </p>
        )}
        <div className="dialog-actions">
          {pending ? (
            <>
              <Button
                variant="ghost"
                className="button proposal-reject"
                disabled={action.busy}
                onClick={() => {
                  setRejecting(true);
                  void action
                    .run(() => request('agent-bridge', 'reject', { id: proposal.id }), onClose)
                    .finally(() => setRejecting(false));
                }}
              >
                {rejecting ? 'Rejecting…' : 'Reject proposal'}
              </Button>
              <Button variant="outline" disabled={action.busy} onClick={onClose}>
                Review later
              </Button>
              <Button
                variant="default"
                className="button primary"
                disabled={action.busy || !acknowledged || !canApply}
                onClick={() =>
                  action.run(async () => {
                    try {
                      const result = await request('agent-bridge', 'apply', {
                        id: proposal.id,
                        digest: proposal.digest,
                        idempotencyKey,
                        ...(review?.currentContextDigest
                          ? { reviewedContextDigest: review.currentContextDigest }
                          : {}),
                      });
                      onApplied({
                        id: result.id,
                        summary: describeTypes(proposal.changes),
                        from: overview.from,
                        count: proposal.changes.length,
                      });
                      return result;
                    } catch (error) {
                      setAcknowledged(false);
                      setReview(null);
                      setReviewVersion((value) => value + 1);
                      throw error;
                    }
                  }, onClose)
                }
              >
                <CheckCircle2 size={16} />
                {action.busy && !rejecting
                  ? 'Applying…'
                  : `Apply all ${proposal.changes.length} change${proposal.changes.length === 1 ? '' : 's'}`}
              </Button>
            </>
          ) : (
            <Button variant="outline" className="button" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
