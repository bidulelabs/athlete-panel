'use client';
import { KeyRound, X } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import { describeAgentAccess } from '@athlete-panel/contracts';
export function ConnectedAgents({ onConnect }: { onConnect: () => void }) {
  const { envelope, request } = useWorkspace();
  const action = useAction();
  return (
    <>
      <ErrorMessage error={action.error} />
      {envelope.grants.length ? (
        envelope.grants.map((grant) => (
          <div className="proposal-row" key={grant.id}>
            <div>
              <strong>{grant.label || 'Training agent'}</strong>
              {describeAgentAccess(grant).map((line) => (
                <p key={line}>{line}</p>
              ))}
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
              onClick={() => action.run(() => request('agent-bridge', 'revoke', { id: grant.id }))}
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
            <Button variant="outline" className="button" onClick={onConnect}>
              Connect an agent
            </Button>
          }
        >
          Approve temporary access when you want an agent to help.
        </EmptyState>
      )}
    </>
  );
}
