'use client';
import { Input, Button } from '@athlete-panel/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ErrorMessage, requestId, type PluginPageProps } from '@athlete-panel/ui';
import type { GarminConnection } from '../../packages/contracts/src/garmin-connection';
import { canRetryConnection, connectionMessage } from './connection-status';

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
        <small id={`${id}-help`}>
          Your key is sent to your instance, stored encrypted, and used by the server to connect to
          Garmin. Athlete Panel never asks for your Garmin password.
        </small>
      </div>
      <Button
        variant="link"
        className="text-button"
        type="button"
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? 'Hide key' : 'Show key'}
      </Button>
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
