"use client";

import { Alert } from '@athlete-panel/ui';
import { Input } from '@athlete-panel/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, ShieldCheck } from 'lucide-react';
import { ErrorMessage, Field, SubmitButton } from '@athlete-panel/ui';

export default function LoginPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetch('/api/auth/status').then(response => response.json()).then(value => setConfigured(value.configured)).catch(() => setError('Unable to reach this instance. Please refresh and try again.')); }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const value = await response.json(); if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message ?? 'Unable to sign in. Check your password.'); const next = new URLSearchParams(window.location.search).get('next'); window.location.assign(next && /^\/agent(?:\?connect=[a-f0-9-]{36})?$/i.test(next) ? next : '/calendar'); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); } finally { setBusy(false); }
  }
  return <main className="login-layout"><section className="login-brand-panel"><div className="brand">Athlete Panel<span>.</span></div><div className="login-visual"><div className="login-orbit"><span className="login-orbit-dot" /><Activity size={69} strokeWidth={1} /></div><div className="login-caption"><h2>Your training. In one place.</h2><p>Plan your week. Record your effort. See your progress.</p></div></div><div className="login-privacy"><ShieldCheck size={16} />Private by design. Hosted by you.</div></section><section className="login-form-panel"><form className="login-form" onSubmit={signIn}><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>{configured === false ? 'Set up your instance' : 'Welcome back'}</h1><p>{configured === false ? 'Initialize the owner account from your server console to start using Athlete Panel.' : 'Sign in to your training workspace.'}</p>{configured === false ? <Alert role="status" className="callout">From the project folder on your server, initialize the owner with <code>pnpm owner bootstrap --password-stdin</code>. Then refresh this page.</Alert> : <><Field label="Password"><Input type="password" autoComplete="current-password" required autoFocus value={password} onChange={event => setPassword(event.target.value)} placeholder="Your instance password" /></Field><ErrorMessage error={error} /><SubmitButton busy={busy || configured === null} className="button primary full-width">Sign in <ArrowRight size={16} /></SubmitButton></>}<div className="login-help">Forgot your password? Use the owner recovery command from your server console. See the development guide for recovery instructions.</div><div className="login-footer">No subscription. No central account.</div></form></section></main>;
}
