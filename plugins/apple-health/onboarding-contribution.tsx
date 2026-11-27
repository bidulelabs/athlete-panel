'use client';

import {
  ErrorMessage,
  useAction,
  type OnboardingConnectionProps,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { useState } from 'react';
import { PhoneSetup, appleHealthConnectionLabel } from './phone-setup';

export function AppleHealthOnboarding({
  onboarding,
  request,
}: PluginPageProps & { onboarding?: OnboardingConnectionProps }) {
  const [token, setToken] = useState<string | null>(null);
  const action = useAction();
  const status = onboarding?.appleHealth;
  if (!onboarding || !status) return null;
  const label = status.connected ? appleHealthConnectionLabel(status) : 'Ready to pair your iPhone';
  const uploads = status.connected
    ? status.lastUploadAt
      ? ' Workouts received.'
      : ' Waiting for workouts.'
    : '';
  if (onboarding.variant === 'summary')
    return (
      <>
        {label}.{uploads}
      </>
    );

  return (
    <>
      <p role="status">
        {label}.{uploads}
      </p>
      <ErrorMessage error={action.error} />
      <PhoneSetup
        status={status}
        token={token}
        busy={onboarding.busy || action.busy}
        onIssue={() =>
          action.run(async () => {
            onboarding.onBusy(true);
            try {
              const result = await request('apple-health', 'issue-token', {});
              setToken(result.token);
              await onboarding.onRefresh();
            } finally {
              onboarding.onBusy(false);
            }
          })
        }
      />
    </>
  );
}
