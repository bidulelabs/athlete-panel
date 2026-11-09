import type { EntityChange } from '@athlete-panel/contracts';

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
};
export const changeAction = (change: EntityChange) =>
  !change.before ? 'create' : !change.after ? 'delete' : 'update';
export function changeTitle(change: EntityChange) {
  const record = change.after ?? change.before;
  return record && 'title' in record
    ? record.title
    : record && 'bodyPart' in record
      ? record.bodyPart
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
  const search = [
    ...[change.before, change.after].flatMap((record) =>
      record
        ? [
            'title' in record ? record.title : '',
            'sport' in record ? record.sport : '',
            'date' in record ? record.date : '',
            'startDate' in record ? record.startDate : '',
          ]
        : [],
    ),
    typeLabels[changeType(change)],
    change.beforeEffectiveDate,
    change.afterEffectiveDate,
  ]
    .join(' ')
    .toLocaleLowerCase();
  return (
    (!type || changeType(change) === type) &&
    (!action || changeAction(change) === action) &&
    search.includes(query.trim().toLocaleLowerCase())
  );
}
