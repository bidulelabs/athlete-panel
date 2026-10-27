'use client';

import { Alert } from '@athlete-panel/ui';
import { Checkbox, Tabs, TabsList, TabsTrigger, TabsContent } from '@athlete-panel/ui';
import { useConfirm } from '@athlete-panel/ui';
import {
  Button,
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@athlete-panel/ui';
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileCheck2,
  KeyRound,
  Plus,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  dateLabel,
  EmptyState,
  ErrorMessage,
  Modal,
  PageHeader,
  requestId,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import type { EntityChange } from '@athlete-panel/contracts';
import { proposalRows } from './proposal-diff';
import './review.css';
import { ConnectAgentDialog, ConnectionApproval } from './connections-client';

export default function AgentBridgePage(_: PluginPageProps) {
  const confirm = useConfirm();
  const { envelope, request } = useWorkspace();
  const [tab, setTab] = useState('proposals');
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const action = useAction();
  useEffect(() => {
    setConnectionId(new URLSearchParams(window.location.search).get('connect'));
  }, []);
  const proposal = envelope.proposals.find((item) => item.id === proposalId);
  const pending = envelope.proposals.filter((item) =>
    ['pending', 'validated', 'proposed', 'ready'].includes(item.status),
  );
  if (connectionId)
    return (
      <ConnectionApproval
        id={connectionId}
        onDone={() => {
          window.history.replaceState(null, '', '/agent');
          setConnectionId(null);
          setTab('grants');
        }}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="YOUR AGENT, YOUR DECISIONS"
        title="Agent workspace"
        description="Connect your external agent. Review its proposed changes here."
        actions={
          <Button variant="default" className="button primary" onClick={() => setConnectOpen(true)}>
            <Plus size={16} />
            Connect an agent
          </Button>
        }
      />
      <div className="agent-intro">
        <div>
          <h2>Plan with your preferred agent</h2>
          <p>
            Connect from your project folder with <code>pnpm agent connect</code>. Approve access in
            your browser, then ask your agent to help with training.
          </p>
        </div>
        <div className="agent-step-list">
          <div className="agent-step">
            <span>1</span>Run the connect command
          </div>
          <div className="agent-step">
            <span>2</span>Approve the matching code and access
          </div>
          <div className="agent-step">
            <span>3</span>Review proposed training changes here
          </div>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList
          className="workspace-tabs"
          style={{ marginTop: 28 }}
          aria-label="Agent workspace sections"
        >
          <TabsTrigger value="proposals">
            Proposals{pending.length ? ` · ${pending.length}` : ''}
          </TabsTrigger>
          <TabsTrigger value="grants">Connected agents</TabsTrigger>
          <TabsTrigger value="history">Change history</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <ErrorMessage error={action.error} />
          {tab === 'proposals' &&
            (envelope.proposals.length ? (
              envelope.proposals.map((item) => (
                <div className="proposal-row" key={item.id}>
                  <div>
                    <strong>{item.summary || 'Training adjustment'}</strong>
                    <p>
                      {item.changes?.length ?? 0} change{item.changes?.length === 1 ? '' : 's'} ·{' '}
                      {new Date(item.createdAt).toLocaleString('en-GB')}
                    </p>
                  </div>
                  <Badge
                    className={`badge ${['pending', 'validated', 'proposed', 'ready'].includes(item.status) ? 'accent' : ''}`}
                  >
                    {item.status}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="button small"
                    onClick={() => setProposalId(item.id)}
                  >
                    <Eye size={14} />
                    Review
                  </Button>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<FileCheck2 size={26} />}
                title="Your next adjustment starts with context"
              >
                Connect your agent, then ask it to adjust next week’s training. Its proposal will
                appear here for review.
              </EmptyState>
            ))}
          {tab === 'grants' &&
            (envelope.grants.length ? (
              envelope.grants.map((grant) => (
                <div className="proposal-row" key={grant.id}>
                  <div>
                    <strong>{grant.label || 'Training agent'}</strong>
                    <p>
                      {dateLabel(grant.from)} — {dateLabel(grant.to)} ·{' '}
                      {grant.includeNotes ? 'Includes notes' : 'Private notes excluded'}
                    </p>
                    <p>Expires {new Date(grant.expiresAt).toLocaleString('en-GB')}</p>
                  </div>
                  <Badge className="badge">
                    {grant.revoked
                      ? 'Disconnected'
                      : new Date(grant.expiresAt).getTime() < Date.now()
                        ? 'Expired'
                        : 'Active'}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="button small"
                    disabled={action.busy || grant.revoked}
                    onClick={() =>
                      action.run(() => request('agent-bridge', 'revoke', { id: grant.id }))
                    }
                  >
                    <X size={14} />
                    Disconnect
                  </Button>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<KeyRound size={26} />}
                title="No connected agents"
                action={
                  <Button variant="outline" className="button" onClick={() => setConnectOpen(true)}>
                    Connect an agent
                  </Button>
                }
              >
                Approve temporary access when you want an agent to help.
              </EmptyState>
            ))}
          {tab === 'history' &&
            (envelope.changes.length ? (
              envelope.changes.map((change) => (
                <div className="proposal-row" key={change.id}>
                  <div>
                    <strong>{change.summary || 'Training data updated'}</strong>
                    <p>
                      {change.changes?.length ?? 0} change{change.changes?.length === 1 ? '' : 's'}{' '}
                      · {new Date(change.createdAt).toLocaleString('en-GB')}
                    </p>
                  </div>
                  <Badge className="badge">{change.undoneAt ? 'Undone' : 'Applied'}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="button small"
                    disabled={action.busy || Boolean(change.undoneAt) || change.undoable === false}
                    onClick={async () => {
                      if (
                        await confirm(
                          'Undo this change set? Undo will be refused if affected records have changed since.',
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
                    <RotateCcw size={14} />
                    Undo
                  </Button>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<RotateCcw size={26} />}
                title="Your change history will appear here"
              >
                Training changes are recorded so you can review and recover them.
              </EmptyState>
            ))}
          <div className="info-line">
            <ShieldCheck size={16} />
            <p>
              Garmin keys and server secrets are excluded. Data you share with an external model
              follows that provider’s privacy practices.
            </p>
          </div>
          {connectOpen && <ConnectAgentDialog onClose={() => setConnectOpen(false)} />}
          {proposal && <ProposalDialog proposal={proposal} onClose={() => setProposalId(null)} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function ProposalDialog({ proposal, onClose }: { proposal: any; onClose: () => void }) {
  const { request, data } = useWorkspace();
  const action = useAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const [idempotencyKey] = useState(requestId);
  const canApply = ['pending', 'validated', 'proposed', 'ready'].includes(proposal.status);
  return (
    <Modal
      open
      onClose={onClose}
      title="Review proposed changes"
      description={proposal.summary || 'Training adjustment'}
      wide
    >
      <div className="dialog-body">
        <p>
          Each affected record is shown below, including schedule and ordering changes. Deletions
          remove the listed record. Apply saves this entire reviewed proposal together.
        </p>
        <div className="form-inline" style={{ justifyContent: 'space-between', marginBottom: 17 }}>
          <Badge className="badge accent">{proposal.status}</Badge>
          <span className="muted-text">
            {proposal.changes?.length ?? 0} change{proposal.changes?.length === 1 ? '' : 's'}
          </span>
        </div>
        {proposal.warnings?.map((warning: any, index: number) => (
          <Alert role="status" className="callout" key={index}>
            {typeof warning === 'string' ? warning : (warning.message ?? JSON.stringify(warning))}
          </Alert>
        ))}
        {proposal.changes?.map((change: any, index: number) => (
          <div className="proposal-diff" key={index}>
            <div className="proposal-diff-head">
              <Badge className="badge">
                {!change.before ? 'Create' : !change.after ? 'Delete' : 'Update'}
              </Badge>
              <span>
                {change.after?.title ??
                  change.before?.title ??
                  change.after?.bodyPart ??
                  change.before?.bodyPart ??
                  change.entity}
              </span>
            </div>
            <Table className="review-fields">
              <caption className="sr-only">Proposed field changes</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposalRows(
                  change as EntityChange,
                  data.profile?.units,
                  Object.fromEntries(data.plans.map((plan) => [plan.id, plan.title])),
                ).map((row) => (
                  <TableRow key={row.field}>
                    <TableHead scope="row">{row.field}</TableHead>
                    <TableCell>
                      <span className="review-mobile-label">Before: </span>
                      {row.before}
                    </TableCell>
                    <TableCell>
                      <span className="review-mobile-label">After: </span>
                      {row.after}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <details className="review-technical">
              <summary>Technical details (complete record)</summary>
              <div className="diff-columns">
                <div>
                  <small>BEFORE</small>
                  <pre>{JSON.stringify(change.before, null, 2)}</pre>
                </div>
                <div>
                  <small>AFTER</small>
                  <pre>{JSON.stringify(change.after, null, 2)}</pre>
                </div>
              </div>
            </details>
          </div>
        ))}
        {canApply && (
          <label className="checkbox-row" style={{ marginTop: 22 }}>
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            I have reviewed these changes and want to apply them.
          </label>
        )}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          {canApply ? (
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
                disabled={action.busy || !acknowledged}
                onClick={() =>
                  action.run(
                    () =>
                      request('agent-bridge', 'apply', {
                        id: proposal.id,
                        digest: proposal.digest,
                        idempotencyKey,
                      }),
                    onClose,
                  )
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
