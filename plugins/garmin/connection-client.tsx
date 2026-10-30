'use client';
import { Input, Button } from '@athlete-panel/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ErrorMessage, requestId, type PluginPageProps } from '@athlete-panel/ui';
import type { GarminConnection } from '../../packages/contracts/src/garmin-connection';
import { canRetryConnection, connectionMessage } from './connection-status';
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';

/** Public, shared connection controls. The key exists only in this mounted form. */
export function GarminKeyForm({
  request,
  onSaved,
  onCancel,
  onBusy,
  submitLabel = 'Connect Garmin',
}: {
  request: PluginPageProps['request'];
  onSaved: () => void;
  onCancel?: () => void;
  onBusy?: (busy: boolean) => void;
  submitLabel?: string;
}) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(requestId());
  const lock = useRef(false);
  const id = useId();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        onBusy?.(true);
        setError(null);
        try {
          await request('garmin', 'configure', { key, idempotencyKey: attempt.current });
          setKey('');
          setVisible(false);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Your key could not be saved. Try again.');
        } finally {
          lock.current = false;
          setBusy(false);
          onBusy?.(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={id}>Garmin Personal API key</label>
        <div className="garmin-key-input">
          <Input
            id={id}
            name="garmin-personal-api-key"
            type={visible ? 'text' : 'password'}
            required
            minLength={8}
            maxLength={4096}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={key}
            disabled={busy}
            aria-describedby={`${id}-help`}
            onChange={(e) => {
              setKey(e.target.value);
              attempt.current = requestId();
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="garmin-key-toggle"
            type="button"
            aria-label={visible ? 'Hide key' : 'Show key'}
            title={visible ? 'Hide key' : 'Show key'}
            aria-controls={id}
            disabled={busy}
            onClick={() => setVisible(!visible)}
          >
            {visible ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </Button>
        </div>
        <small id={`${id}-help`}>
          Your key is sent to your instance, stored encrypted, and used by the server to connect to
          Garmin. Athlete Panel never asks for your Garmin password.
        </small>
        <Button variant="link" asChild className="garmin-key-help">
          <a
            href="https://developer.garmin.com/gc-developer-program/personal/personal-api/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get a personal API key <ArrowUpRight size={14} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </div>
      <ErrorMessage error={error} />
      <div className="dialog-actions">
        {onCancel && (
          <Button variant="outline" className="button" type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="default"
          type="submit"
          className="button primary"
          disabled={busy || !key.trim()}
        >
          {busy ? 'Saving key…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function GarminConnectionStatus({
  value,
  workerAvailable,
  retry,
  busy,
  children,
}: {
  value: GarminConnection;
  workerAvailable: boolean;
  retry?: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const message = connectionMessage(value, workerAvailable);
  return (
    <div className="onboarding-connection">
      <p role="status" aria-live="polite">
        {message}
      </p>
      {value.currentJob?.retrying && value.currentJob.nextRunAt && (
        <p className="muted-text">
          Retrying at {new Date(value.currentJob.nextRunAt).toLocaleString()}.
        </p>
      )}
      {value.verified && value.currentJob?.progress && (
        <p className="muted-text">{value.currentJob.progress}</p>
      )}
      {canRetryConnection(value) && retry && (
        <Button variant="outline" type="button" className="button" disabled={busy} onClick={retry}>
          Retry connection
        </Button>
      )}
      {children}
    </div>
  );
}
