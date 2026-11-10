'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound } from 'lucide-react';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  ErrorMessage,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';
import {
  describeAgentAccess,
  historicalScope,
  planningScope,
  type GrantSummary,
} from '@athlete-panel/contracts';

function ConnectionRow({
  grant,
  now,
  onRevoked,
}: {
  grant: GrantSummary;
  now: number;
  onRevoked: () => void;
}) {
  const { request } = useWorkspace();
  const action = useAction();
  const confirm = useConfirm();
  const history = historicalScope(grant);
  const planning = planningScope(grant);
  const expired = Date.parse(grant.expiresAt) <= now;
  const active = !grant.revoked && !expired;
  const state = grant.revoked ? 'Disconnected' : expired ? 'Expired' : 'Active';
  const capability =
    history && planning
      ? 'History and training proposals'
      : history
        ? 'History only · analysis access'
        : 'Training proposals';
  const revoke = async () => {
    if (
      await confirm(
        `Disconnect “${grant.label || 'Training agent'}”? This revokes its access and prevents applying any pending proposals associated with this connection.`,
        active ? 'Disconnect agent' : 'Revoke access',
      )
    )
      void action.run(() => request('agent-bridge', 'revoke', { id: grant.id }), onRevoked);
  };
  return (
    <Collapsible className="agent-connection-row">
      <div className="agent-connection-heading">
        <strong>{grant.label || 'Training agent'}</strong>
        <Badge className="badge">{state}</Badge>
      </div>
      <p className="agent-capability">{capability}</p>
      <p className="agent-row-meta">
        <span>
          {expired ? 'Expired' : 'Expires'}{' '}
          {new Date(grant.expiresAt).toLocaleString('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
        {(history?.includeNotes || planning?.includeNotes) && (
          <span className="agent-notes-shared">Private notes shared</span>
        )}
      </p>
      <div className="agent-row-actions">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="agent-access-trigger">
            Access details
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        {active && (
          <Button variant="outline" disabled={action.busy} onClick={revoke}>
            {action.busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        )}
      </div>
      <ErrorMessage error={action.error} />
      <CollapsibleContent className="agent-access-details">
        {describeAgentAccess(grant).map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>Access expiry: {new Date(grant.expiresAt).toLocaleString('en-GB')}</p>
        {expired && !grant.revoked && (
          <>
            <p>
              Expired access stops new reads and proposals. Revoking also prevents applying existing
              pending proposals.
            </p>
            <Button variant="outline" disabled={action.busy} onClick={revoke}>
              {action.busy ? 'Revoking…' : 'Revoke access'}
            </Button>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ConnectedAgents() {
  const { envelope } = useWorkspace();
  const [now, setNow] = useState(Date.now);
  const inactiveSummary = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const active = envelope.grants.filter(
    (grant) => !grant.revoked && Date.parse(grant.expiresAt) > now,
  );
  const inactive = envelope.grants.filter(
    (grant) => grant.revoked || Date.parse(grant.expiresAt) <= now,
  );
  const row = (grant: GrantSummary) => (
    <ConnectionRow
      key={grant.id}
      grant={grant}
      now={now}
      onRevoked={() => requestAnimationFrame(() => inactiveSummary.current?.focus())}
    />
  );
  return (
    <>
      {active.length ? (
        active.map(row)
      ) : (
        <EmptyState icon={<KeyRound size={26} />} title="No active connections">
          Use Connect an agent to approve temporary access.
        </EmptyState>
      )}
      {inactive.length > 0 && (
        <details className="agent-archive">
          <summary ref={inactiveSummary}>Inactive connections · {inactive.length}</summary>
          {inactive.map(row)}
        </details>
      )}
    </>
  );
}
