import type { AuditEntry, EntityChange, Plan } from '@athlete-panel/contracts';
import { dateLabel, distance, duration } from '@athlete-panel/ui';

const labels: Record<string, string> = {
  durationSeconds: 'Duration',
  distanceMeters: 'Distance',
  plannedElevationGainMeters: 'Elevation gain',
  startDate: 'Start date',
  endDate: 'End date',
  notes: 'Description',
  body: 'Note text',
  steps: 'Intervals',
  exercises: 'Strength exercises',
  order: 'Position in day',
  sportSubgroup: 'Sport type',
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

export function historyTitle(entry: AuditEntry) {
  if (entry.summary.startsWith('Undo:')) return 'Reverted training changes';
  const verbs: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    duplicate: 'Duplicated',
    complete: 'Logged',
    clearCompletion: 'Cleared completion for',
    link: 'Linked an activity to',
    unlink: 'Unlinked an activity from',
  };
  if (entry.summary === 'workout.reorder') return 'Reordered workouts';
  const [entity, action] = entry.summary.split('.');
  const verb = action ? verbs[action] : undefined;
  const candidates = historyRecords(entry).filter((change) => change.entity === entity);
  const record =
    action === 'create' || action === 'duplicate'
      ? candidates.find((change) => !change.before)
      : action === 'delete'
        ? candidates.find((change) => !change.after)
        : (candidates.find((change) => changedFields(change).some((field) => field !== 'order')) ??
          candidates[0]);
  if (verb && record) return `${verb} ${recordName(record)}`;
  // Preserve descriptive proposal summaries, while folding command batches into plain language.
  return entry.summary.trim() &&
    !/\b(?:profile|plan|workout|note|event|injury)\.[a-zA-Z]+/.test(entry.summary)
    ? entry.summary
    : 'Updated training';
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
    label: readable(key),
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
