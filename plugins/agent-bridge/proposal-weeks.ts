import type { EntityChange } from '@athlete-panel/contracts';
import { startOfWeek, type WeekStartsOn } from '../../packages/ui/src/calendar-dates';

export const calendarDate = (change: EntityChange) =>
  change.afterEffectiveDate ?? change.beforeEffectiveDate ?? null;

export function groupChangesByWeek<Change extends EntityChange>(
  changes: readonly Change[],
  weekStartsOn: WeekStartsOn,
) {
  const weeks = new Map<string | null, Change[]>();
  const changesByDate = [...changes].sort((a, b) =>
    (calendarDate(a) ?? '').localeCompare(calendarDate(b) ?? ''),
  );
  for (const change of changesByDate) {
    const date = calendarDate(change);
    const weekStart = date && startOfWeek(date, weekStartsOn);
    if (!weeks.has(weekStart)) weeks.set(weekStart, []);
    weeks.get(weekStart)!.push(change);
  }
  return [...weeks].map(([weekStart, weekChanges]) => ({ weekStart, changes: weekChanges }));
}

export function planTitlesById(
  plans: readonly { id: string; title: string }[],
  changes: readonly EntityChange[],
): Record<string, string> {
  const titles = Object.fromEntries(plans.map((plan) => [plan.id, plan.title]));
  for (const change of changes) {
    const plan = change.entity === 'plan' ? (change.after ?? change.before) : null;
    if (plan && 'title' in plan) titles[plan.id] = plan.title;
  }
  return titles;
}

/** Month membership follows each record's resulting date (previous date for deletions).
 * A week crossing a month is shown in both months, with only that month's records. */
export function groupChangesByMonth<Change extends EntityChange>(changes: readonly Change[]) {
  const months = new Map<string | null, Change[]>();
  for (const change of [...changes].sort((a, b) =>
    (calendarDate(a) ?? '').localeCompare(calendarDate(b) ?? ''),
  )) {
    const month = calendarDate(change)?.slice(0, 7) ?? null;
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push(change);
  }
  return [...months].map(([month, items]) => ({ month, changes: items }));
}

export function summarizeProposal(changes: readonly EntityChange[]) {
  const dates = changes
    .flatMap((change) =>
      [change.beforeEffectiveDate, change.afterEffectiveDate].filter((date): date is string =>
        Boolean(date),
      ),
    )
    .sort();
  const sports = new Set<string>();
  for (const change of changes) {
    for (const record of [change.before, change.after])
      if (record && 'sport' in record && record.sport) sports.add(record.sport);
  }
  return {
    from: dates.at(0),
    to: dates.at(-1),
    sports: [...sports].sort(),
    added: changes.filter((change) => !change.before).length,
    changed: changes.filter((change) => change.before && change.after).length,
    deleted: changes.filter((change) => !change.after).length,
  };
}
