import type { EntityChange, Period } from '@athlete-panel/contracts';
import { dateLabel, duration } from '@athlete-panel/ui';
import { targetRangeLabel, weekTargets } from '../training/public/shared';

export const proposalDateOptions = { weekday: 'short', day: 'numeric', month: 'short' } as const;

export const editedWeekFacts = (phase: Period) =>
  Object.keys(phase.editedWeeks).map((monday) => {
    const dayInsidePhase = monday <= phase.endDate ? monday : phase.endDate;
    const hours = weekTargets([phase], dayInsidePhase)!.weeklyDurationSeconds;
    return `week of ${dateLabel(monday, proposalDateOptions)} edited${hours ? ` to ${targetRangeLabel(hours, duration)}` : ''}`;
  });
const searchableDate = (date: string | null | undefined) =>
  date ? `${date} ${dateLabel(date, proposalDateOptions)}` : '';

export function changeType(change: EntityChange): string {
  const record = change.after ?? change.before;
  return change.entity === 'event' && record && 'kind' in record
    ? (record.kind ?? 'event')
    : change.entity;
}

export const typeLabels: Record<string, string> = {
  workout: 'Workout',
  race: 'Race',
  goal: 'Goal',
  note: 'Note',
  plan: 'Plan',
  other: 'Event',
  event: 'Event',
  activity: 'Activity',
  health: 'Health record',
  injury: 'Injury',
  profile: 'Profile',
  period: 'Phase',
};
export const changeAction = (change: EntityChange) =>
  !change.before ? 'create' : !change.after ? 'delete' : 'update';
export function changeTitle(change: EntityChange) {
  const record = change.after ?? change.before;
  return record && 'title' in record
    ? record.title
    : record && 'bodyPart' in record
      ? record.bodyPart
      : record && 'role' in record
        ? record.name
        : (typeLabels[changeType(change)] ?? change.entity);
}

export function typeCounts(changes: readonly EntityChange[]) {
  const counts = new Map<string, number>();
  for (const change of changes) {
    const type = changeType(change);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, count }));
}

export function describeTypes(changes: readonly EntityChange[]) {
  return typeCounts(changes)
    .map(
      ({ type, count }) =>
        `${count} ${(typeLabels[type] ?? type).toLowerCase()}${count === 1 ? '' : 's'}`,
    )
    .join(' · ');
}

export function matchesChange(change: EntityChange, query: string, type: string, action: string) {
  if ((type && changeType(change) !== type) || (action && changeAction(change) !== action))
    return false;
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const search = [
    ...[change.before, change.after].flatMap((record) =>
      record
        ? [
            'title' in record ? record.title : '',
            'sport' in record ? record.sport : '',
            'date' in record ? searchableDate(record.date) : '',
            'startDate' in record ? searchableDate(record.startDate) : '',
          ]
        : [],
    ),
    typeLabels[changeType(change)],
    searchableDate(change.beforeEffectiveDate),
    searchableDate(change.afterEffectiveDate),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return search.includes(needle);
}
