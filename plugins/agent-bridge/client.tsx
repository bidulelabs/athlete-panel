'use client';
import { useEffect, useState } from 'react';
import { Eye, FileCheck2, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  useConfirm,
  EmptyState,
  ErrorMessage,
  PageHeader,
  requestId,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { ConnectAgentDialog, ConnectionApproval } from './connections-client';
import { ConnectedAgents } from './connections-list';
import { ProposalLoader } from './proposal-dialog';
import './review.css';
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
            <span>2</span>Type the terminal code and approve access
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
                      {item.affectedCount ?? item.changes.length} change
                      {(item.affectedCount ?? item.changes.length) === 1 ? '' : 's'} ·{' '}
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
          {tab === 'grants' && <ConnectedAgents onConnect={() => setConnectOpen(true)} />}
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
          {proposal && <ProposalLoader proposal={proposal} onClose={() => setProposalId(null)} />}
        </TabsContent>
      </Tabs>
    </>
  );
}
