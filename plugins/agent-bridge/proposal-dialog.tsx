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
  sportLabel,
  requestId,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import {
  proposalReviewSchema,
  type ProposalReview,
  type ProposalSummary,
} from '@athlete-panel/contracts';
import { summarizeProposal, planTitlesById } from './proposal-weeks';
import { ProposedEdits, ReviewChange } from './proposal-changes';
export function ProposalLoader({
  proposal,
  onClose,
}: {
  proposal: ProposalSummary;
  onClose: () => void;
}) {
  const { request } = useWorkspace();
  const [details, setDetails] = useState<ProposalSummary | null>(
    proposal.changes.length ? proposal : null,
  );
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
  if (details) return <ProposalDialog proposal={details} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title="Review proposed changes">
      <div className="dialog-body">
        <p role="status">Loading proposed edits…</p>
        <ErrorMessage error={error} />
        {error && <Button onClick={() => setRetry((v) => v + 1)}>Retry details</Button>}
      </div>
    </Modal>
  );
}

function ProposalDialog({ proposal, onClose }: { proposal: ProposalSummary; onClose: () => void }) {
  const { request, data } = useWorkspace();
  const planTitles = planTitlesById(data.plans, proposal.changes);
  const action = useAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const [idempotencyKey] = useState(requestId);
  const [review, setReview] = useState<ProposalReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
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
    <Modal
      open
      onClose={onClose}
      title="Review proposed changes"
      description={proposal.summary || 'Training adjustment'}
      wide
    >
      <div className="dialog-body">
        <section className="proposal-overview" aria-label="Proposal overview">
          {overview.from && (
            <p className="proposal-overview-dates">
              {dateLabel(overview.from, { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
              {dateLabel(overview.to!, { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
          {!!overview.sports.length && <p>{overview.sports.map(sportLabel).join(' · ')}</p>}
          <dl className="proposal-counts">
            <div>
              <dt>Added</dt>
              <dd>{overview.added}</dd>
            </div>
            <div>
              <dt>Changed</dt>
              <dd>{overview.changed}</dd>
            </div>
            <div>
              <dt>Deleted</dt>
              <dd>{overview.deleted}</dd>
            </div>
          </dl>
          <p className="muted-text">
            Open a month, week or record to inspect the exact edits. Apply saves this entire
            proposal together.
          </p>
        </section>
        <div className="form-inline" style={{ justifyContent: 'space-between', marginBottom: 17 }}>
          <Badge className="badge accent">{proposal.status}</Badge>
          <span className="muted-text">
            {proposal.changes?.length ?? 0} change{proposal.changes?.length === 1 ? '' : 's'}
          </span>
        </div>
        {proposal.warnings?.map((warning, index) => (
          <Alert role="status" className="callout" key={index}>
            {typeof warning === 'string' ? warning : (warning.message ?? JSON.stringify(warning))}
          </Alert>
        ))}
        {pending && !review && !reviewError && (
          <p role="status">Checking proposal and current context…</p>
        )}
        {reviewError && (
          <>
            <ErrorMessage error={reviewError} />
            <Button variant="outline" onClick={() => setReviewVersion((value) => value + 1)}>
              Retry review
            </Button>
          </>
        )}
        {review && (
          <p className="muted-text">
            Apply before {new Date(review.expiresAt).toLocaleString()} · Seven days from submission
          </p>
        )}
        {review?.conflicts.map((conflict) => (
          <Alert className="callout" key={conflict.code}>
            {conflict.message}
          </Alert>
        ))}
        {!!review?.contextChanges.length && (
          <section aria-label="Changed context">
            <h3>Context changed since submission</h3>
            <p>
              These facts changed after the agent prepared this proposal. Review them before
              deciding whether the proposed training still suits you.
            </p>
            {review.contextChanges.map((change, index) => (
              <ReviewChange
                change={change}
                planTitles={planTitles}
                caption="Context at submission and now"
                key={index}
              />
            ))}
          </section>
        )}
        <section aria-label="Proposed edits">
          <h3>Proposed edits</h3>
          <ProposedEdits changes={proposal.changes} planTitles={planTitles} />
        </section>
        {canApply && (
          <label className="checkbox-row" style={{ marginTop: 22 }}>
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            {review?.applicability === 'review-required'
              ? 'I have reviewed the changed context and still want to apply these exact edits.'
              : 'I have reviewed these changes and want to apply them.'}
          </label>
        )}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          {pending ? (
            <>
              <Button
                variant="outline"
                className="button"
                disabled={action.busy}
                onClick={() =>
                  action.run(() => request('agent-bridge', 'reject', { id: proposal.id }), onClose)
                }
              >
                Reject proposal
              </Button>
              <Button
                variant="default"
                className="button primary"
                disabled={action.busy || !acknowledged || !canApply}
                onClick={() =>
                  action.run(async () => {
                    try {
                      return await request('agent-bridge', 'apply', {
                        id: proposal.id,
                        digest: proposal.digest,
                        idempotencyKey,
                        ...(review?.currentContextDigest
                          ? { reviewedContextDigest: review.currentContextDigest }
                          : {}),
                      });
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
                {action.busy ? 'Applying…' : 'Apply reviewed changes'}
              </Button>
            </>
          ) : (
            <Button variant="outline" className="button" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
