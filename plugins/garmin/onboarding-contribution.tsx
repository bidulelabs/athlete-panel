'use client';
import { Button, type OnboardingConnectionProps, type PluginPageProps } from '@athlete-panel/ui';
import { GarminKeyForm, GarminConnectionStatus } from './connection-client';
import { connectionMessage } from './connection-status';
export function OnboardingConnection({
  request,
  onboarding,
}: PluginPageProps & { onboarding?: OnboardingConnectionProps }) {
  if (!onboarding) return null;
  const {
    variant,
    connection,
    workerAvailable,
    busy: locked,
    editingKey,
    onEditingChange: setEditingKey,
    onBusy: setKeyBusy,
    onRefresh: refreshStatus,
    onError: setError,
  } = onboarding;
  if (variant === 'summary') return <>{connectionMessage(connection, workerAvailable)}</>;
  return (
    <>
      {' '}
      {!connection.connected || editingKey ? (
        <>
          <p className="muted-text">
            Sign in to Garmin Connect, open Personal API Key, create a key, accept Garmin's terms
            and choose its expiry. Copy the key when Garmin displays it; you cannot view it again
            later.
          </p>
          <GarminKeyForm
            request={request}
            onBusy={setKeyBusy}
            onSaved={() => {
              setEditingKey(false);
              void refreshStatus();
            }}
            onCancel={editingKey ? () => setEditingKey(false) : undefined}
          />
        </>
      ) : (
        <>
          <GarminConnectionStatus
            value={connection}
            workerAvailable={workerAvailable}
            busy={locked}
            retry={() => {
              void request('garmin', 'sync', {
                mode: connection.currentJob?.kind === 'garmin-recent' ? 'recent' : 'full',
              })
                .then(refreshStatus)
                .catch((err) => setError(err.message));
            }}
          />
          <Button
            variant="link"
            type="button"
            className="text-button"
            disabled={locked}
            onClick={() => setEditingKey(true)}
          >
            Replace API key
          </Button>
        </>
      )}
    </>
  );
}
