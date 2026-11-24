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
  eventId: 'Race',
  workoutId: 'Session',
  openQuestions: 'Open questions',
  fromMeters: 'From',
  toMeters: 'To',
  writtenFor: 'Written for',
  courseId: 'Course',
  startTime: 'Start time',
  finishCutoff: 'Finish cutoff',
  stations: 'Aid stations',
  dayOffset: 'Days after race day',
  stopSeconds: 'Planned stop',
  verified: 'Confirmed',
  dropBag: 'Drop bag',
  everyMinutes: 'Every',
  carbohydrateGramsPerHour: 'Carbohydrate',
  fluidMillilitresPerHour: 'Fluid',
  sodiumMilligramsPerHour: 'Sodium',
  productId: 'Product',
  daysBefore: 'Days before',
};
const listItemLabels: Record<string, string> = {
  exercises: 'Exercise',
  pacing: 'Section',
  assumptions: 'Assumption',
  openQuestions: 'Open question',
  stations: 'Aid station',
  dropBag: 'Item',
  schedule: 'Row',
  cues: 'Cue',
};
const unitsByField: Record<string, string> = {
  carbohydrateGramsPerHour: 'g per hour',
  fluidMillilitresPerHour: 'ml per hour',
  sodiumMilligramsPerHour: 'mg per hour',
  everyMinutes: 'min',
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
  namesById: Record<string, string>,
  missingProductName: string,
  path: string[],
) {
  const weeklyField = path.find((part) => part.startsWith('weekly'));
  const key = weeklyField && ['min', 'max'].includes(leafKey) ? weeklyField : leafKey;
  if (value === undefined) return 'Not present';
  if (value === null) return key.toLowerCase().includes('date') ? 'Unscheduled' : 'Not set';
  if (value === '') return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (['planId', 'eventId', 'workoutId'].includes(key) && typeof value === 'string')
    return namesById[value] ?? value;
  if (key === 'productId' && typeof value === 'string')
    return namesById[value] ?? missingProductName;
  if (typeof value === 'number') {
    if (unitsByField[key]) return `${value} ${unitsByField[key]}`;
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
  namesById: Record<string, string> = {},
  missingProductName = 'Product no longer in your profile',
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
    if (path[0] === 'stations' && key === 'id') return;
    if (
      before === undefined &&
      (after === null || after === '' || (Array.isArray(after) && !after.length))
    )
      return;
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
            ? `${listItemLabels[path[index - 1]!] ?? 'Step'} ${Number(part) + 1}`
            : path.length === 1 && part === 'notes' && change.entity === 'workout'
              ? 'Workout description'
              : part === 'schedule' && path[0] === 'nutrition'
                ? 'Food schedule'
                : path[index - 1] === 'editedWeeks'
                  ? `Week of ${part}`
                  : readable(part),
        )
        .join(' · '),
      before: valueText(before, key, beforeParent, units, namesById, missingProductName, path),
      after: valueText(after, key, afterParent, units, namesById, missingProductName, path),
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
