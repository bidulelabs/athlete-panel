'use client';

import { Alert } from '@athlete-panel/ui';
import { Checkbox, Button, Input, NativeSelect } from '@athlete-panel/ui';
import { useEffect, useState } from 'react';
import { Check, Clipboard, ShieldCheck, Terminal } from 'lucide-react';
import type { AgentConnectionStatus } from '@athlete-panel/contracts';
import {
  addDays,
  ErrorMessage,
  Field,
  Modal,
  PageHeader,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';

export function ConnectAgentDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const origin = typeof window === 'undefined' ? 'http://127.0.0.1:3000' : window.location.origin;
  const command =
    origin === 'http://127.0.0.1:3000'
      ? 'pnpm agent connect'
      : `pnpm agent connect --url ${origin}`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Connect your agent"
      description="Approve access in your browser. No token copying needed."
    >
      <div className="dialog-body">
        <div className="agent-handoff-note">
          <Terminal size={22} />
          <div>
            <strong>From your project folder</strong>
            <p>Run this command in your terminal. It opens a browser approval page.</p>
          </div>
        </div>
        <div className="token-reveal">{command}</div>
        <Button
          variant="outline"
          className="button"
          onClick={() =>
            action.run(async () => {
              await navigator.clipboard.writeText(command);
              setCopied(true);
            })
          }
        >
          {copied ? <Check size={16} /> : <Clipboard size={16} />}
          {copied ? 'Command copied' : 'Copy command'}
        </Button>
        <ol>
          <li>Check that the approval code matches your terminal.</li>
          <li>Choose dates, notes access, and when access expires.</li>
          <li>
            Ask your agent to read the training-planning skill linked in AGENTS.md and propose your
            changes.
          </li>
        </ol>
        <p className="form-footnote">
          The credential is saved privately on your computer. Proposed training changes still need
          your review and approval here.
        </p>
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="default" className="button primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ConnectionApproval({ id, onDone }: { id: string; onDone: () => void }) {
  const { request, data } = useWorkspace();
  const [connection, setConnection] = useState<AgentConnectionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matched, setMatched] = useState(false);
  const [now, setNow] = useState(Date.now());
  const action = useAction();
  useEffect(() => {
    let current = true;
    request('agent-bridge', 'connection', { id })
      .then((value) => {
        if (current) setConnection(value);
      })
      .catch((error) => {
        if (current) setLoadError(error.message);
      });
    return () => {
      current = false;
    };
  }, [id, request]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const todayParts = new Intl.DateTimeFormat('en', {
    timeZone: data.profile?.timezone ?? 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => todayParts.find((value) => value.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const expired = connection && Date.parse(connection.expiresAt) <= now;
  const pending = connection?.status === 'pending' && !expired;
  const approved = connection?.status === 'approved' && !expired;
  return (
    <>
      <PageHeader
        eyebrow="YOUR AGENT, YOUR PERMISSION"
        title="Connect your training agent"
        description="Only approve a connection you started from your terminal."
      />
      <section className="section-block" style={{ maxWidth: 680 }}>
        <ErrorMessage error={loadError} />
        {!connection && !loadError && <p role="status">Loading the connection request…</p>}
        {connection && pending && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void action.run(async () => {
                const result = await request('agent-bridge', 'approve-connection', {
                  id,
                  code: connection.code,
                  label: String(form.get('label')),
                  from: String(form.get('from')),
                  to: String(form.get('to')),
                  includeNotes: form.get('includeNotes') === 'on',
                  expiresInHours: Number(form.get('expiresInHours')),
                });
                setConnection(result);
              });
            }}
          >
            <p>
              Compare this code with the one shown by <code>pnpm agent connect</code>:
            </p>
            <div
              className="token-reveal"
              style={{ fontSize: 26, letterSpacing: '0.12em', textAlign: 'center' }}
              aria-label="Approval code"
            >
              {connection.code}
            </div>
            <label className="checkbox-row">
              <Checkbox
                required
                checked={matched}
                onCheckedChange={(value) => setMatched(value === true)}
              />
              This code matches my terminal
            </label>
            <div className="form-divider" />
            <Field label="Agent name">
              <Input required name="label" maxLength={100} defaultValue={connection.label} />
            </Field>
            <div className="form-grid">
              <Field label="Read records from">
                <Input required type="date" name="from" defaultValue={addDays(today, -28)} />
              </Field>
              <Field label="Through">
                <Input required type="date" name="to" defaultValue={addDays(today, 14)} />
              </Field>
            </div>
            <Field label="Access expires after">
              <NativeSelect name="expiresInHours" defaultValue="1">
                <option value="1">1 hour</option>
                <option value="4">4 hours</option>
                <option value="24">24 hours</option>
              </NativeSelect>
            </Field>
            <label className="checkbox-row">
              <Checkbox name="includeNotes" />
              Include private plan, workout, interval, completion, and calendar notes
            </label>
            <Alert role="status" className="callout">
              <strong>What you are sharing</strong>
              <p>
                Your profile, goals, availability, zones, and relevant training, events, injury
                constraints, activities, and health records. Your external agent may send this
                context to its model provider.
              </p>
              <p>
                Access allows reading context and submitting proposals. Applying changes still
                requires your review in Athlete Panel. Garmin keys and server secrets are excluded.
              </p>
            </Alert>
            <p className="form-footnote">
              This connection request expires at{' '}
              {new Date(connection.expiresAt).toLocaleTimeString()}. You can disconnect the agent at
              any time.
            </p>
            <ErrorMessage error={action.error} />
            <div className="dialog-actions">
              <Button
                variant="outline"
                type="button"
                className="button"
                disabled={action.busy}
                onClick={() =>
                  action.run(async () =>
                    setConnection(await request('agent-bridge', 'deny-connection', { id })),
                  )
                }
              >
                Decline
              </Button>
              <Button
                variant="default"
                type="submit"
                className="button primary"
                disabled={action.busy || !matched}
              >
                <ShieldCheck size={16} />
                {action.busy ? 'Approving…' : 'Approve connection'}
              </Button>
            </div>
          </form>
        )}
        {connection && !pending && (
          <div role="status">
            <h2>
              {approved
                ? 'Agent access approved'
                : expired || connection.status === 'expired'
                  ? 'Connection request expired'
                  : 'Connection not approved'}
            </h2>
            <p>
              {approved
                ? 'Return to your terminal to finish connecting. It will save the credential automatically. You can then ask your agent to propose training changes.'
                : 'No active connection can be completed from this request. Run pnpm agent connect to start again.'}
            </p>
            {approved && (
              <p>
                Access expires {new Date(connection.grant!.expiresAt).toLocaleString()}. Proposed
                changes will appear in the Agent workspace for your review.
              </p>
            )}
          </div>
        )}
        {!pending && (
          <Button variant="outline" className="button" onClick={onDone}>
            Back to Agent workspace
          </Button>
        )}
      </section>
    </>
  );
}
