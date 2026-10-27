'use client';
import { NativeSelect } from '@athlete-panel/ui';
import { useId, useMemo } from 'react';
import { timezoneSchema, type Profile } from '@athlete-panel/contracts';
import type { Preferences } from '../../packages/contracts/src/onboarding';
import { resolveWeekStartsOn } from '@athlete-panel/ui';

export function suggestedPreferences(profile: Profile | null, detected?: string): Preferences {
  return {
    timezone: profile?.timezone ?? (timezoneSchema.safeParse(detected).success ? detected! : 'UTC'),
    units: profile?.units ?? 'metric',
    weekStartsOnPreference: profile?.weekStartsOnPreference ?? 'auto',
  };
}
export function PreferenceFields({
  value,
  onChange,
  detected,
}: {
  value: Preferences;
  onChange: (value: Preferences) => void;
  detected?: string;
}) {
  const id = useId();
  const zones = useMemo(() => {
    let supported: string[] = [];
    try {
      supported = Intl.supportedValuesOf('timeZone');
    } catch {
      /* Older browsers still offer valid saved/detected values. */
    }
    return [
      ...new Set([
        'UTC',
        value.timezone,
        ...(detected && timezoneSchema.safeParse(detected).success ? [detected] : []),
        ...supported,
      ]),
    ].sort();
  }, [value.timezone, detected]);
  const automatic =
    resolveWeekStartsOn(
      'auto',
      typeof navigator === 'undefined' ? undefined : navigator.language,
    ) === 0
      ? 'Sunday'
      : 'Monday';
  return (
    <div className="preference-fields">
      <div className="field">
        <label htmlFor={`${id}-timezone`}>Timezone</label>
        <NativeSelect
          id={`${id}-timezone`}
          name="timezone"
          required
          value={value.timezone}
          aria-describedby={`${id}-timezone-help`}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone === 'UTC' ? 'UTC' : `${zone.split('/').at(-1)!.replaceAll('_', ' ')} — ${zone}`}
            </option>
          ))}
        </NativeSelect>
        <small id={`${id}-timezone-help`}>
          {detected
            ? 'Suggested from this device. Check that it matches where you train.'
            : "We couldn't detect your timezone. Choose one, or keep UTC."}
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-units`}>Measurement units</label>
        <NativeSelect
          id={`${id}-units`}
          name="units"
          required
          value={value.units}
          aria-describedby={`${id}-units-help`}
          onChange={(e) => onChange({ ...value, units: e.target.value as Preferences['units'] })}
        >
          <option value="metric">Metric — kilometers and meters</option>
          <option value="imperial">Imperial — miles and feet</option>
        </NativeSelect>
        <small id={`${id}-units-help`}>Used for distances and elevation.</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-week`}>First day of the week</label>
        <NativeSelect
          id={`${id}-week`}
          name="weekStartsOnPreference"
          value={value.weekStartsOnPreference}
          aria-describedby={`${id}-week-help`}
          onChange={(e) =>
            onChange({
              ...value,
              weekStartsOnPreference: e.target.value as Preferences['weekStartsOnPreference'],
            })
          }
        >
          <option value="auto">Automatic — {automatic}</option>
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </NativeSelect>
        <small id={`${id}-week-help`}>
          Automatic follows this browser's region. Choose a day to keep the same layout on every
          device.
        </small>
      </div>
    </div>
  );
}
