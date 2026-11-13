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
  endsOnLapButton: 'Ends on lap button',
  sport: 'Sport group',
  sportSubgroup: 'Sport subgroup',
  plannedElevationGainMeters: 'Planned elevation gain',
  exercises: 'Strength exercises',
  weightKg: 'Weight',
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
  weeklyDurationSeconds: 'Weekly hours',
  weeklyDistanceMeters: 'Weekly distance',
  weeklyElevationGainMeters: 'Weekly climbing',
  editedWeeks: 'Edited weeks',
  firstWeek: 'First week',
  lastWeek: 'Last week',
};
const readable = (key: string) =>
  labels[key] ??
  key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());
const words: Record<string, string> = {
  race: 'Race',
  goal: 'Goal',
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  other: 'Other',
  rest: 'Rest day',
  workout: 'Training session',
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
  leafKey: string,
  parent: Record<string, unknown>,
  units: 'metric' | 'imperial',
  plans: Record<string, string>,
  path: string[],
) {
  const weeklyField = path.find((part) => part.startsWith('weekly'));
  const key = weeklyField && ['min', 'max'].includes(leafKey) ? weeklyField : leafKey;
  if (value === undefined) return 'Not present';
  if (value === null) return key.toLowerCase().includes('date') ? 'Unscheduled' : 'Not set';
  if (value === '') return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'planId' && typeof value === 'string') return plans[value] ?? value;
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
    if (key === 'weightKg')
      return `${Number((value * (units === 'imperial' ? 2.2046226218 : 1)).toPrecision(10))} ${units === 'imperial' ? 'lb' : 'kg'}`;
    if (key.endsWith('ElevationGainMeters'))
      return `${Number((value * (units === 'imperial' ? 3.28084 : 1)).toPrecision(10))} ${units === 'imperial' ? 'ft' : 'm'}`;
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
  return key === 'kind' || key === 'role' ? (words[String(value)] ?? String(value)) : String(value);
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
        .map((part, index) =>
          /^\d+$/.test(part)
            ? `${path[index - 1] === 'exercises' ? 'Exercise' : 'Step'} ${Number(part) + 1}`
            : path.length === 1 && part === 'notes' && change.entity === 'workout'
              ? 'Workout description'
              : path[index - 1] === 'editedWeeks'
                ? `Week of ${part}`
                : readable(part),
        )
        .join(' · '),
      before: valueText(before, key, beforeParent, units, plans, path),
      after: valueText(after, key, afterParent, units, plans, path),
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
