'use client';
import { useEffect, useState } from 'react';
import { Eye, FileCheck2, Plus, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  EmptyState,
  PageHeader,
  dateLabel,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { planningScope, type ProposalSummary } from '@athlete-panel/contracts';
import { ConnectAgentDialog, ConnectionApproval } from './connections-client';
import { ConnectedAgents } from './connections-list';
import { AgentHistory } from './history-client';
import { ProposalLoader, type ProposalReceipt } from './proposal-dialog';
import { AppliedProposal } from './proposal-receipt';
import './review.css';
import './workspace.css';

function ProposalRow({ item, onReview }: { item: ProposalSummary; onReview: () => void }) {
  const { from, to } = item.dateBounds;
  const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' } as const;
  return (
    <div className="proposal-row agent-proposal-row">
      <div className="agent-row-copy">
        <strong className="agent-summary-preview">{item.summary || 'Training adjustment'}</strong>
        <p className="agent-row-meta">
          {from && (
            <span>
              {dateLabel(from, dateOptions)}
              {to && to !== from && ` – ${dateLabel(to, dateOptions)}`}
            </span>
          )}
          <span>
            {item.affectedCount} change{item.affectedCount === 1 ? '' : 's'}
          </span>
          <span>
            Submitted{' '}
            {new Date(item.createdAt).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        </p>
      </div>
      <div className="agent-row-actions">
        <Badge className="badge">{item.status}</Badge>
        <Button variant="outline" onClick={onReview}>
          <Eye size={16} aria-hidden="true" />
          {item.status === 'pending' ? 'Review' : 'View details'}
        </Button>
      </div>
    </div>
  );
}

export default function AgentBridgePage(_: PluginPageProps) {
  const { envelope } = useWorkspace();
  const [tab, setTab] = useState('proposals');
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ProposalReceipt | null>(null);
  useEffect(() => {
    setConnectionId(new URLSearchParams(window.location.search).get('connect'));
  }, []);
  const proposal = envelope.proposals.find((item) => item.id === proposalId);
  const pending = envelope.proposals.filter((item) => item.status === 'pending');
  const past = envelope.proposals.filter((item) => item.status !== 'pending');
  const hasPlanningAccess = envelope.grants.some(
    (grant) => !grant.revoked && Date.parse(grant.expiresAt) > Date.now() && planningScope(grant),
  );
  const proposalRow = (item: ProposalSummary) => (
    <ProposalRow key={item.id} item={item} onReview={() => setProposalId(item.id)} />
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
    <div className="agent-workspace">
      <PageHeader
        title="Agent workspace"
        actions={
          <>
            <AgentHistory />
            <Button variant="default" onClick={() => setConnectOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Connect an agent
            </Button>
          </>
        }
      />
      {receipt && (
        <AppliedProposal key={receipt.id} receipt={receipt} onDismiss={() => setReceipt(null)} />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="workspace-tabs agent-tabs" aria-label="Agent workspace sections">
          <TabsTrigger value="proposals">
            Proposals{pending.length ? ` · ${pending.length}` : ''}
          </TabsTrigger>
          <TabsTrigger value="grants">Connected agents</TabsTrigger>
        </TabsList>
        <TabsContent value="proposals">
          {pending.length ? (
            pending.map(proposalRow)
          ) : (
            <EmptyState icon={<FileCheck2 size={26} />} title="No proposals awaiting review">
              {hasPlanningAccess
                ? 'Ask your agent to propose a training adjustment.'
                : 'Connect an agent with proposal access to suggest training changes.'}
            </EmptyState>
          )}
          {past.length > 0 && (
            <details className="agent-archive">
              <summary>Past proposals · {past.length}</summary>
              {past.map(proposalRow)}
            </details>
          )}
        </TabsContent>
        <TabsContent value="grants">
          <ConnectedAgents />
        </TabsContent>
      </Tabs>
      <details className="agent-sharing">
        <summary>
          <ShieldCheck size={16} aria-hidden="true" />
          About shared data
        </summary>
        <p>
          Garmin keys and server secrets are excluded. Data you share with an external model follows
          that provider’s privacy practices.
        </p>
      </details>
      {connectOpen && <ConnectAgentDialog onClose={() => setConnectOpen(false)} />}
      {proposal && (
        <ProposalLoader
          key={proposal.id}
          proposal={proposal}
          onClose={() => setProposalId(null)}
          onApplied={setReceipt}
        />
      )}
    </div>
  );
}
