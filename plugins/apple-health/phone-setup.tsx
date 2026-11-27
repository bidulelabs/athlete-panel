'use client';
import type { AppleHealthConnection } from '@athlete-panel/contracts';
import { Button, Field, Input } from '@athlete-panel/ui';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './page.css';

export function appleHealthConnectionLabel(status: AppleHealthConnection) {
  if (!status.connected) return 'Disconnected';
  return status.testedAt ? 'Connection tested' : 'Waiting for iPhone test';
}

function CopyValue({
  label,
  value,
  buttonLabel,
  focusCopy = false,
}: {
  label: string;
  value: string;
  buttonLabel: string;
  focusCopy?: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const copy = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusCopy) copy.current?.focus();
  }, [focusCopy]);
  return (
    <div className="apple-copy">
      <Field label={label}>
        <Input ref={input} value={value} readOnly spellCheck={false} autoComplete="off" />
      </Field>
      <Button
        ref={copy}
        variant="outline"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setFeedback(`${label} copied.`);
          } catch {
            input.current?.focus();
            input.current?.select();
            setFeedback('Value selected. Copy it manually.');
          }
        }}
      >
        <Copy size={15} />
        {buttonLabel}
      </Button>
      {feedback && <span role="status">{feedback}</span>}
    </div>
  );
}

export function PhoneSetup({
  status,
  token,
  busy,
  onIssue,
  onDisconnect,
}: {
  status: AppleHealthConnection;
  token: string | null;
  busy: boolean;
  onIssue: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <div className="apple-phone-setup">
      <ol>
        <li>
          Install{' '}
          <a
            href="https://apps.apple.com/app/sync-for-health/id6819742018"
            target="_blank"
            rel="noreferrer"
          >
            Sync for Health
          </a>{' '}
          on an iPhone with iOS 26 or later.
        </li>
        <li>
          Enter the upload URL and token in the app. Grant Workouts access and tap Test connection.
        </li>
        <li>
          Leave GPS workout routes off for the first history sync. Tap Sync now, then enable routes
          for new workouts.
        </li>
      </ol>
      {status.uploadUrl ? (
        <CopyValue label="Upload URL" value={status.uploadUrl} buttonLabel="Copy URL" />
      ) : (
        <p>Configure the instance’s HTTPS address to generate an upload URL.</p>
      )}
      <div className="apple-health-actions">
        <Button disabled={busy || !status.uploadUrl} onClick={onIssue}>
          {status.connected ? 'Rotate upload token' : 'Create upload token'}
        </Button>
        {status.connected && onDisconnect && (
          <Button variant="outline" disabled={busy} onClick={onDisconnect}>
            Disconnect
          </Button>
        )}
      </div>
      {token && (
        <>
          <CopyValue
            label="Upload token"
            value={token}
            buttonLabel="Copy token"
            focusCopy
            key={token}
          />
          <p className="form-footnote">
            Copy the token before leaving setup. Rotating it revokes the previous token.
          </p>
        </>
      )}
      <p className="form-footnote">
        Use Sync now on the iPhone to retry. To restore older workouts or routes, use Resend all
        history. If an upload is too large, turn off GPS workout routes and resend the summaries.
      </p>
    </div>
  );
}
