'use client';

import { Alert } from '@athlete-panel/ui';
import { Checkbox, Button, Input, NativeSelect } from '@athlete-panel/ui';
import { useEffect, useState } from 'react';
import { Check, Clipboard, ShieldCheck, Terminal } from 'lucide-react';
import {
  addCalendarYears,
  planningScope,
  planningScopeSchema,
  historyScopeSchema,
  type AgentConnectionStatus,
} from '@athlete-panel/contracts';
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
          <li>Type the approval code shown in your terminal.</li>
          <li>
            Choose historical review, training proposals or both, their separate dates, notes access
            and expiry.
          </li>
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
  const { request, data, weekStartsOn } = useWorkspace();
  const [mode, setMode] = useState('planning');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [connection, setConnection] = useState<AgentConnectionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
            onChange={() => setFieldErrors({})}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const typedCode = String(form.get('code'))
                .replace(/[^0-9a-f]/gi, '')
                .toUpperCase();
              const errors: Record<string, string> = {};
              if (mode !== 'history') {
                const checked = planningScopeSchema.safeParse({
                  from: String(form.get('from')),
                  to: String(form.get('to')),
                });
                if (!checked.success)
                  errors.planning = checked.error.issues.map((i) => i.message).join(' ');
              }
              if (mode !== 'planning') {
                const checked = historyScopeSchema.safeParse({
                  from: String(form.get('historyFrom')),
                  to: String(form.get('historyTo')),
                  categories: form.getAll('categories'),
                  weekStartsOn,
                });
                if (!checked.success)
                  errors.history = checked.error.issues.map((i) => i.message).join(' ');
              }
              setFieldErrors(errors);
              if (Object.keys(errors).length) return;
              void action.run(async () => {
                const result = await request('agent-bridge', 'approve-connection', {
                  id,
                  code: `${typedCode.slice(0, 4)}-${typedCode.slice(4)}`,
                  label: String(form.get('label')),
                  version: 2,
                  history:
                    mode === 'planning'
                      ? null
                      : {
                          from: String(form.get('historyFrom')),
                          to: String(form.get('historyTo')),
                          includeNotes: form.get('historyNotes') === 'on',
                          categories: form.getAll('categories') as (
                            'activities' | 'health' | 'training' | 'context'
                          )[],
                          weekStartsOn,
                        },
                  planning:
                    mode === 'history'
                      ? null
                      : {
                          from: String(form.get('from')),
                          to: String(form.get('to')),
                          includeNotes: form.get('includeNotes') === 'on',
                        },
                  expiresInHours: Number(form.get('expiresInHours')),
                });
                setConnection(result);
              });
            }}
          >
            <Field label="Approval code" hint="Type the code shown by pnpm agent connect.">
              <Input
                required
                name="code"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX"
                style={{ fontSize: 26, letterSpacing: '0.12em', textAlign: 'center' }}
              />
            </Field>
            <div className="form-divider" />
            <Field label="Agent name">
              <Input required name="label" maxLength={100} defaultValue={connection.label} />
            </Field>
            <Field label="Access purpose">
              <NativeSelect value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="planning">Training proposals</option>
                <option value="history">Historical review</option>
                <option value="both">Both</option>
              </NativeSelect>
            </Field>
            {mode !== 'planning' && (
              <fieldset>
                <legend>Historical review · up to five calendar years</legend>
                <div className="form-grid">
                  <Field label="History from">
                    <Input
                      required
                      type="date"
                      name="historyFrom"
                      defaultValue={addCalendarYears(today, -5)}
                    />
                  </Field>
                  <Field label="History through">
                    <Input required type="date" name="historyTo" defaultValue={today} />
                  </Field>
                </div>
                <ErrorMessage error={fieldErrors.history ?? null} />
                {(['activities', 'health', 'training', 'context'] as const).map((category) => (
                  <label className="checkbox-row" key={category}>
                    <Checkbox name="categories" value={category} defaultChecked />
                    {category === 'context'
                      ? 'Current profile, goals, events and injury context'
                      : category === 'training'
                        ? 'Plans, workouts and recorded completion'
                        : category === 'health'
                          ? 'Health measurements'
                          : 'Recorded activities'}
                  </label>
                ))}
                <label className="checkbox-row">
                  <Checkbox name="historyNotes" />
                  Include private notes in historical review
                </label>
                <p className="form-footnote">
                  Dates include both endpoints. Weeks start{' '}
                  {weekStartsOn === 0 ? 'Sunday' : 'Monday'}, captured from your current preference.
                  Future scheduled records are allowed.
                </p>
              </fieldset>
            )}
            {mode !== 'history' && (
              <fieldset>
                <legend>Training proposals · up to one calendar year</legend>
                <div className="form-grid">
                  <Field label="Read records from">
                    <Input required type="date" name="from" defaultValue={addDays(today, -28)} />
                  </Field>
                  <Field label="Through">
                    <Input required type="date" name="to" defaultValue={addDays(today, 14)} />
                  </Field>
                </div>
                <ErrorMessage error={fieldErrors.planning ?? null} />
                <label className="checkbox-row">
                  <Checkbox name="includeNotes" />
                  Include private plan, workout, interval, completion, and calendar notes
                </label>
                <p className="form-footnote">
                  Shares profile, goals, availability, zones, training, events, injuries, activities
                  and health within this planning scope. Both dates are inclusive. Proposed changes
                  still require your review and explicit application.
                </p>
              </fieldset>
            )}
            <Field label="Access expires after">
              <NativeSelect name="expiresInHours" defaultValue="1">
                <option value="1">1 hour</option>
                <option value="4">4 hours</option>
                <option value="24">24 hours</option>
              </NativeSelect>
            </Field>
            <Alert role="status" className="callout">
              <strong>What you are sharing</strong>
              <p>
                Only the selected capabilities, dates and categories above. Your external agent may
                send this context to its model provider.
              </p>
              <p>
                {mode === 'history'
                  ? 'This connection is read-only. Proposal submission is not permitted.'
                  : 'Proposal submission is permitted only within the separate planning dates. Applying changes requires your explicit review and approval in Athlete Panel.'}{' '}
                Garmin keys, server secrets, raw provider payloads and GPS are excluded.
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
                disabled={action.busy}
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
                ? 'Return to your terminal to finish connecting. It will save the credential automatically. You can then ask your agent to use the approved capabilities.'
                : 'No active connection can be completed from this request. Run pnpm agent connect to start again.'}
            </p>
            {approved && (
              <p>
                Access expires {new Date(connection.grant!.expiresAt).toLocaleString()}.{' '}
                {planningScope(connection.grant!)
                  ? 'Proposed changes will appear in the Agent workspace for your review and explicit approval.'
                  : 'This access is read-only; proposal submission is not permitted.'}
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
