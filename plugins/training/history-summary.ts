import type { AuditEntry, EntityChange, Plan } from '@athlete-panel/contracts';
import { dateLabel, distance, duration } from '@athlete-panel/ui';

const labels: Record<string, string> = {
  durationSeconds: 'Duration',
  distanceMeters: 'Distance',
  plannedElevationGainMeters: 'Planned elevation gain',
  startDate: 'Start date',
  endDate: 'End date',
  notes: 'Notes',
  body: 'Note text',
  steps: 'Intervals',
  exercises: 'Strength exercises',
  order: 'Position in day',
  sport: 'Sport group',
  sportSubgroup: 'Sport subgroup',
  completion: 'Completion',
};
const readable = (key: string) =>
  labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (s) => s.toUpperCase());

export function recordName(change: EntityChange) {
  const value = change.after ?? change.before;
  if (value && 'title' in value) return value.title;
  if (value && 'displayName' in value) return value.displayName;
  return readable(change.entity);
}

export function changedFields(change: EntityChange) {
  const before = (change.before ?? {}) as Record<string, unknown>;
  const after = (change.after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) =>
      !['id', 'revision'].includes(key) &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

export function historyRecords(entry: AuditEntry) {
  return entry.changes.filter(
    (change) =>
      !change.before ||
      !change.after ||
      changedFields(change).length > 0 ||
      change.beforeEffectiveDate !== change.afterEffectiveDate,
  );
}

function valueText(
  value: unknown,
  key: string,
  units: 'metric' | 'imperial',
  plans: Plan[],
): string | null {
  if (value == null || value === '') return key === 'startDate' ? 'Unscheduled' : 'Not set';
  if (key === 'schedule' && typeof value === 'object' && 'kind' in value) {
    if (value.kind === 'independent' && 'date' in value) return dateLabel(String(value.date));
    if ('day' in value && 'planId' in value)
      return `${plans.find((plan) => plan.id === value.planId)?.title ?? 'Plan'} · Day ${value.day}`;
  }
  if (typeof value === 'object') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (key.endsWith('Seconds')) return duration(value);
    if (key === 'distanceMeters') return distance(value, units);
    if (key === 'plannedElevationGainMeters')
      return `${Math.round(value * (units === 'imperial' ? 3.28084 : 1))} ${units === 'imperial' ? 'ft' : 'm'}`;
  }
  if (/Date$/.test(key) || key === 'date') return dateLabel(String(value));
  return String(value);
}

export function historyFields(change: EntityChange, units: 'metric' | 'imperial', plans: Plan[]) {
  const before = (change.before ?? {}) as Record<string, unknown>;
  const after = (change.after ?? {}) as Record<string, unknown>;
  // New/deleted items need identifying context; updates show every affected field.
  const keys = changedFields(change).filter((key) =>
    change.before && change.after
      ? true
      : ['startDate', 'schedule', 'sport', 'durationSeconds'].includes(key),
  );
  const rows = keys.map((key) => ({
    label: key === 'notes' && change.entity === 'workout' ? 'Workout description' : readable(key),
    before: valueText(before[key], key, units, plans),
    after: valueText(after[key], key, units, plans),
  }));
  if (change.beforeEffectiveDate !== change.afterEffectiveDate)
    rows.unshift({
      label: 'Calendar date',
      before: valueText(change.beforeEffectiveDate, 'startDate', units, plans),
      after: valueText(change.afterEffectiveDate, 'startDate', units, plans),
    });
  return rows;
}
