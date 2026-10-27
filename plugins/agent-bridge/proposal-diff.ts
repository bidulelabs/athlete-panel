import type { EntityChange } from '@athlete-panel/contracts';

export interface ReviewRow {
  field: string;
  before: string;
  after: string;
}
const labels: Record<string, string> = {
  durationSeconds: 'Duration',
  distanceMeters: 'Distance',
  startDate: 'Start date',
  endDate: 'End date',
  order: 'Position in day',
  steps: 'Intervals',
  kind: 'Type',
  times: 'Repetitions',
  target: 'Target',
  min: 'Minimum',
  max: 'Maximum',
  schedule: 'Schedule',
  planId: 'Plan',
  day: 'Day in plan',
  body: 'Note text',
  notes: 'Notes',
  beforeEffectiveDate: 'Calendar date',
  afterEffectiveDate: 'Calendar date',
};
const readable = (key: string) =>
  labels[key] ??
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());
const words: Record<string, string> = {
  independent: 'Independent workout',
  plan: 'Plan workout',
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  work: 'Work',
  recovery: 'Recovery',
  repeat: 'Repeat group',
  heartRateBpm: 'Heart rate',
  powerWatts: 'Power',
  paceSecondsPerKilometer: 'Pace',
  rpe: 'Perceived effort (1–10)',
};
function valueText(
  value: unknown,
  key: string,
  parent: Record<string, unknown>,
  units: 'metric' | 'imperial',
  plans: Record<string, string>,
) {
  if (value === undefined) return 'Not present';
  if (value === null) return key.toLowerCase().includes('date') ? 'Unscheduled' : 'Not set';
  if (value === '') return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'planId' && typeof value === 'string')
    return plans[value] ? `${plans[value]} (${value})` : value;
  if (typeof value === 'number') {
    if (key.endsWith('Seconds')) {
      const hours = Math.floor(value / 3600),
        minutes = Math.floor((value % 3600) / 60),
        seconds = value % 60;
      return [
        hours && `${hours} h`,
        minutes && `${minutes} min`,
        (seconds || !value) && `${seconds} s`,
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (key.endsWith('Meters'))
      return `${Number((value / (units === 'imperial' ? 1609.344 : 1000)).toPrecision(10))} ${units === 'imperial' ? 'mi' : 'km'}`;
    if (key === 'min' || key === 'max') {
      if (parent.kind === 'heartRateBpm') return `${value} bpm`;
      if (parent.kind === 'powerWatts') return `${value} W`;
      if (parent.kind === 'rpe') return `${value} / 10`;
      if (parent.kind === 'paceSecondsPerKilometer') return `${value} s/km`;
    }
  }
  if (Array.isArray(value)) return value.length ? String(value) : 'None';
  return key === 'kind' ? (words[String(value)] ?? String(value)) : String(value);
}

/** Walk every field, including unknown additions; only identity/revision metadata is folded away. */
export function proposalRows(
  change: EntityChange,
  units: 'metric' | 'imperial' = 'metric',
  plans: Record<string, string> = {},
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const visit = (
    before: unknown,
    after: unknown,
    path: string[],
    beforeParent: Record<string, unknown> = {},
    afterParent: Record<string, unknown> = {},
  ) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const key = path.at(-1) ?? '';
    if (path.length === 1 && ['id', 'revision'].includes(key)) return;
    const object = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === 'object';
    if (object(before) || object(after)) {
      const left = object(before) ? before : {},
        right = object(after) ? after : {};
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
      if (keys.length) {
        for (const child of keys) visit(left[child], right[child], [...path, child], left, right);
        return;
      }
    }
    rows.push({
      field: path
        .map((part) => (/^\d+$/.test(part) ? `Step ${Number(part) + 1}` : readable(part)))
        .join(' · '),
      before: valueText(before, key, beforeParent, units, plans),
      after: valueText(after, key, afterParent, units, plans),
    });
  };
  visit(change.before ?? {}, change.after ?? {}, []);
  if (change.beforeEffectiveDate !== change.afterEffectiveDate)
    rows.unshift({
      field: 'Calendar date',
      before: change.beforeEffectiveDate ?? 'Unscheduled',
      after: change.afterEffectiveDate ?? 'Unscheduled',
    });
  return rows;
}
