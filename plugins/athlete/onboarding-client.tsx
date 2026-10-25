'use client';
import { Button } from '@athlete-panel/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Onboarding, Preferences } from '../../packages/contracts/src/onboarding';
import type { GarminConnection } from '../../packages/contracts/src/garmin-connection';
import { ErrorMessage, Modal, operationalHealth, requestId, resolveWeekStartsOn, useAction, useWorkspace } from '@athlete-panel/ui';
import { GarminKeyForm, GarminConnectionStatus } from '../garmin/client';
import { connectionMessage } from '../garmin/connection-status';
import { PreferenceFields, suggestedPreferences } from './preferences';
import './onboarding.css';

export function OnboardingResume() {
  const { envelope, request } = useWorkspace(); const action = useAction();
  const state = envelope.onboarding;
  if (!state || state.status === 'completed') return null;
  return <div className="onboarding-resume"><div><strong>Welcome setup</strong><p>Confirm your preferences and optionally connect Garmin.</p><ErrorMessage error={action.error} /></div>
    <Button variant="outline" className="button" disabled={action.busy} onClick={() => action.run(() => request('athlete', 'onboarding', { action: 'resume', expectedRevision: state.revision, idempotencyKey: requestId() }))}>{state.status === 'existing-owner' ? 'Run welcome setup' : 'Finish setup'}</Button>
  </div>;
}

function PreferenceStep({ busy, save, reviewVersion }: { busy: boolean; save: (values: Preferences, revision: number | null) => void; reviewVersion: number }) {
  const { data } = useWorkspace();
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState(() => suggestedPreferences(data.profile, detected));
  const [revision, setRevision] = useState(data.profile?.revision ?? null);
  const reviewed = useRef(reviewVersion);
  useEffect(() => { if (reviewed.current === reviewVersion) return; reviewed.current = reviewVersion;
    setDraft(suggestedPreferences(data.profile, detected)); setRevision(data.profile?.revision ?? null);
  }, [reviewVersion, data.profile, detected]);
  return <form onSubmit={event => { event.preventDefault(); save(draft, revision); }}>
    <p>Choose how dates and distances appear. You can change these anytime in Settings.</p>
    <PreferenceFields value={draft} onChange={setDraft} detected={detected} />
    <p className="muted-text">Heart-rate zones, FTP and other training settings can wait.</p>
    <div className="dialog-actions"><Button variant="default" className="button primary" disabled={busy}>{busy ? 'Saving preferences…' : 'Save and continue'}</Button></div>
  </form>;
}

export function OnboardingDialog() {
  const { envelope, data, request, refresh, navigate, path } = useWorkspace();
  const [state, setState] = useState<Onboarding | undefined>(envelope.onboarding);
  const latest = useRef(state);
  const [closed, setClosed] = useState(false); const dismissedRevision = useRef(0);
  const [busy, setBusy] = useState(false); const [keyBusy, setKeyBusy] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [error, setError] = useState<string | null>(null); const [closeError, setCloseError] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [connection, setConnection] = useState<GarminConnection>(envelope.garmin);
  const [worker, setWorker] = useState<unknown>(envelope.operational?.find(row => row.key === 'worker')?.value);
  const [statusError, setStatusError] = useState(false);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const enabled = envelope.plugins.some(plugin => plugin.id === 'garmin' && plugin.enabled);
  const approvalLink = path === '/agent' && new URLSearchParams(window.location.search).has('connect');
  const open = !!state && ['pending','active'].includes(state.status) && !closed && !approvalLink;
  const acceptState = useCallback((next?: Onboarding) => {
    if (!next || (latest.current && next.revision < latest.current.revision)) return;
    latest.current = next; setState(next);
    if (next.status === 'active' && next.revision > dismissedRevision.current) setClosed(false);
  }, []);
  useEffect(() => { acceptState(envelope.onboarding); }, [envelope.onboarding, acceptState]);
  const pollSequence = useRef(0);
  const statusInFlight = useRef(false);
  useEffect(() => { pollSequence.current++; setConnection(envelope.garmin); }, [envelope.garmin]);
  const refreshStatus = useCallback(async () => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;
    const sequence = ++pollSequence.current;
    try {
      const response = await fetch('/api/onboarding', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (response.status === 401) { await refresh(); return; }
      if (!response.ok) throw new Error('Status unavailable');
      const result = await response.json();
      if (sequence !== pollSequence.current) return;
      acceptState(result.onboarding); setConnection(result.garmin); setWorker(result.worker); setStatusError(false);
    } catch { if (sequence === pollSequence.current) setStatusError(true); }
    finally { statusInFlight.current = false; }
  }, [acceptState, refresh]);
  useEffect(() => {
    if (!open) return;
    const update = () => { if (!document.hidden) void refreshStatus(); };
    update();
    const timer = setInterval(update, 10000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); pollSequence.current++; };
  }, [open, refreshStatus]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, state?.step]);
  useEffect(() => { setEditingKey(false); setKeyBusy(false); setError(null); }, [state?.step, open]);

  async function advance(action: string, extra: Record<string, unknown> = {}) {
    if (inFlight.current || !latest.current) return;
    setBusy(true); setError(null);
    const payload = { action, expectedRevision: latest.current.revision, ...extra };
    const fingerprint = JSON.stringify(payload);
    if (attempt.current?.payload !== fingerprint) attempt.current = { payload: fingerprint, id: requestId() };
    const promise = request('athlete', 'onboarding', { ...payload, idempotencyKey: attempt.current.id });
    inFlight.current = promise;
    try {
      const next = await promise as Onboarding; acceptState(next); attempt.current = null;
      if (action === 'complete') navigate('/calendar');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your setup could not be saved. Please try again.');
      await refreshStatus();
    } finally { inFlight.current = null; setBusy(false); }
  }
  async function dismiss(destination?: string) {
    setClosed(true); dismissedRevision.current = Number.MAX_SAFE_INTEGER; setEditingKey(false); setCloseError(false);
    // Let a submitted preference save finish, then defer its resulting step.
    await inFlight.current?.catch(() => {});
    try {
      const response = await fetch('/api/onboarding', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Unable to load setup');
      const current = (await response.json()).onboarding as Onboarding;
      if (current.status !== 'completed') {
        const next = await request('athlete', 'onboarding', { action: 'defer', expectedRevision: current.revision, idempotencyKey: requestId() }) as Onboarding;
        acceptState(next); dismissedRevision.current = next.revision;
      } else { acceptState(current); dismissedRevision.current = current.revision; }
    } catch { setCloseError(true); dismissedRevision.current = latest.current?.revision ?? 0; }
    if (destination) navigate(destination);
  }
  const workerAvailable = !operationalHealth({ worker }).workerWarning;
  const locked = busy || keyBusy;
  const step = state?.step ?? 1;
  const week = resolveWeekStartsOn(data.profile?.weekStartsOnPreference, navigator.language) === 0 ? 'Sunday' : 'Monday';
  return <>
    {closeError && <div className="onboarding-resume" role="status"><p>Couldn't save your setup progress. Setup may reopen after refresh.</p><Button variant="outline" className="button" onClick={() => void dismiss()}>Retry saving progress</Button></div>}
    <Modal open={open} onClose={() => void dismiss()} title="Welcome to Athlete Panel" description="Make this workspace yours. Confirm a few preferences and connect Garmin if you use it." closeLabel="Finish setup later" closeOnBackdrop={false} focusHeading initialFocusRef={heading} className="onboarding-dialog">
      <div className="dialog-body">
        <ol className="onboarding-steps" aria-label="Setup progress">{['Preferences','Garmin','Ready'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
        <h3 ref={heading} tabIndex={-1} className="onboarding-step-title"><span className="sr-only">Step {step} of 3 — </span>{step === 1 ? 'Your preferences' : step === 2 ? 'Connect Garmin — optional' : 'Ready to start'}</h3>
        <ErrorMessage error={error} />
        {error && <Button variant="link" type="button" className="text-button" onClick={async () => { await refresh(); await refreshStatus(); setReviewVersion(value => value + 1); setError(null); }}>Review latest settings</Button>}
        {step === 1 && <PreferenceStep busy={busy} reviewVersion={reviewVersion} save={(values, revision) => void advance('preferences', { values, expectedProfileRevision: revision })} />}
        {step === 2 && <>
          <p>Bring in your recorded activities, sleep duration and stages, sleep score, resting heart rate, HRV, steps, stress and Body Battery. Availability depends on your Garmin devices and history. Athlete Panel reads your data; it does not upload training to Garmin.</p>
          <p className="muted-text">Recent data is imported first. Older history follows in the background while your instance is running. You can start using the calendar right away.</p>
          {!enabled ? <p>Garmin is disabled. You can enable it later in Plugins.</p> : <>
            {(!connection.connected || editingKey) ? <>
              <p><a href="https://developer.garmin.com/gc-developer-program/personal/personal-api/" target="_blank" rel="noopener noreferrer">Get a Garmin Personal API key<span className="sr-only"> (opens in a new tab)</span></a></p>
              <p className="muted-text">Sign in to Garmin Connect, open Personal API Key, create a key, accept Garmin's terms and choose its expiry. Copy the key when Garmin displays it; you cannot view it again later.</p>
              <GarminKeyForm request={request} onBusy={setKeyBusy} onSaved={() => { setEditingKey(false); void refreshStatus(); }} onCancel={editingKey ? () => setEditingKey(false) : undefined} />
            </> : <><GarminConnectionStatus value={connection} workerAvailable={workerAvailable} busy={locked} retry={() => { void request('garmin','sync',{ mode: connection.currentJob?.kind === 'garmin-recent' ? 'recent' : 'full' }).then(refreshStatus).catch(err => setError(err.message)); }} /><Button variant="link" type="button" className="text-button" disabled={locked} onClick={() => setEditingKey(true)}>Replace API key</Button></>}
          </>}
          <div className="dialog-actions"><Button variant="outline" className="button" disabled={locked} onClick={() => void advance('back')}>Back</Button><Button variant="default" className="button primary" disabled={locked} onClick={() => void advance('continue')}>{connection.connected && enabled ? 'Continue' : 'Skip for now'}</Button></div>
          {connection.connected && !connection.verified && !connection.paused && <p className="muted-text">We'll keep checking in the background.</p>}
        </>}
        {step === 3 && <>
          <p>Your workspace is ready. You can plan training now, even while Garmin is importing.</p>
          <dl className="onboarding-summary"><div><dt>Timezone</dt><dd>{data.profile?.timezone ?? 'Unavailable'}</dd></div><div><dt>Units</dt><dd>{data.profile?.units === 'imperial' ? 'Imperial — miles and feet' : 'Metric — kilometers and meters'}</dd></div><div><dt>Week starts on</dt><dd>{!data.profile?.weekStartsOnPreference || data.profile.weekStartsOnPreference === 'auto' ? `Automatic — ${week} on this device` : week}</dd></div><div><dt>Garmin</dt><dd role="status">{enabled ? connectionMessage(connection, workerAvailable) : 'Garmin is disabled.'}</dd></div></dl>
          <p>Change preferences and training settings in <Button variant="link" className="text-button" onClick={() => void dismiss('/settings')}>Settings</Button>. Check your connection and import progress from <Button variant="link" className="text-button" onClick={() => void dismiss('/garmin')}>Garmin</Button> in the sidebar.</p>
          <div className="dialog-actions"><Button variant="outline" className="button" disabled={locked} onClick={() => void advance('back')}>Back</Button><Button variant="default" className="button primary" disabled={locked} onClick={() => void advance('complete')}>{busy ? 'Opening your calendar…' : error ? 'Try again' : 'Open my calendar'}</Button></div>
        </>}
        {statusError && <div role="status"><p>We couldn't refresh Garmin status. Your import may still be running.{connection.checkedAt && ` Last checked ${new Date(connection.checkedAt).toLocaleString()}.`}</p><Button variant="link" className="text-button" onClick={() => void refreshStatus()}>Refresh status</Button></div>}
        {!workerAvailable && connection.connected && step > 1 && <p className="muted-text">Check the background worker in <Button variant="link" className="text-button" onClick={() => void dismiss('/plugins')}>Plugins → Instance status</Button>.</p>}
        <p className="onboarding-footer">Saved steps are kept. You can finish later in Settings.</p>
      </div>
    </Modal>
  </>;
}
