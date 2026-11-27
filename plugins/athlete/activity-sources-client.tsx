'use client';

import { activityProviderLabel, type ActivityProvider } from '@athlete-panel/contracts';
import {
  Button,
  ErrorMessage,
  OnboardingConnectionSlot,
  useAction,
  useWorkspace,
  type OnboardingConnectionProps,
} from '@athlete-panel/ui';
import { useEffect, useId, useRef, useState } from 'react';
import './activity-sources.css';

const sources = [
  {
    id: 'garmin',
    path: '/garmin',
    description: 'Activities and daily health from Garmin Connect.',
  },
  {
    id: 'apple-health',
    path: '/apple-health',
    description: 'Apple Watch workouts and optional routes from Sync for Health on iPhone.',
  },
] satisfies { id: ActivityProvider; path: string; description: string }[];

export function ActivitySourceOptions({
  setup,
  selection,
}: {
  setup?: Omit<OnboardingConnectionProps, 'variant'>;
  selection?: ActivityProvider[];
}) {
  const { envelope, request, navigate } = useWorkspace();
  const selected = selection ?? envelope.activitySources?.selected ?? [];
  const available = sources.filter(({ id }) =>
    envelope.plugins.some((plugin) => plugin.id === id && plugin.enabled),
  );
  const [expanded, setExpanded] = useState<ActivityProvider | null>(
    () => (setup ? selected[0] : null) ?? null,
  );
  const action = useAction();
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!moveFocus.current || !panelHeading.current) return;
    moveFocus.current = false;
    panelHeading.current.focus();
  }, [expanded]);

  function openSource(source: (typeof sources)[number], chosen: boolean) {
    if (setup && expanded === source.id) {
      setExpanded(null);
      return;
    }
    void action.run(async () => {
      setup?.onBusy(true);
      try {
        if (!chosen) await request('athlete', 'choose-activity-source', { source: source.id });
        if (setup) {
          moveFocus.current = true;
          setExpanded(source.id);
          if (!chosen) await setup.onRefresh();
        } else {
          navigate(source.path);
        }
      } finally {
        setup?.onBusy(false);
      }
    });
  }

  if (!available.length) return <p>Enable an activity import plugin in Plugins to add a source.</p>;
  return (
    <div className="activity-source-chooser">
      <ul className="activity-source-options">
        {available.map((source) => {
          const name = activityProviderLabel(source.id);
          const chosen = selected.includes(source.id);
          const open = Boolean(setup && expanded === source.id);
          const label = chosen ? `${setup ? 'Set up' : 'Manage'} ${name}` : `Add ${name}`;
          const id = `${panelId}-${source.id}`;
          return (
            <li key={source.id}>
              <div className="activity-source-option">
                <div>
                  <strong>{name}</strong>
                  <p>{source.description}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={action.busy || setup?.busy}
                  aria-expanded={setup ? open : undefined}
                  aria-controls={open ? id : undefined}
                  aria-label={open ? `Hide setup for ${name}` : undefined}
                  onClick={() => openSource(source, chosen)}
                >
                  {open ? 'Hide setup' : label}
                </Button>
              </div>
              {open && setup && (
                <div
                  className="activity-source-setup"
                  id={id}
                  role="region"
                  aria-labelledby={`${id}-heading`}
                >
                  <h4
                    className="activity-source-setup-title"
                    id={`${id}-heading`}
                    ref={panelHeading}
                    tabIndex={-1}
                  >
                    {name} setup
                  </h4>
                  <OnboardingConnectionSlot {...setup} pluginId={source.id} variant="setup" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorMessage error={action.error} />
      {selected.includes('garmin') && selected.includes('apple-health') && (
        <p className="form-footnote">
          If Garmin Connect also writes rides to Apple Health, exclude Garmin Connect under Apple
          Health → Recording sources to count each ride once.
        </p>
      )}
    </div>
  );
}
