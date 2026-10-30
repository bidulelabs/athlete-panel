import type { EntityChange } from '@athlete-panel/contracts';
import { startOfWeek, type WeekStartsOn } from '../../packages/ui/src/calendar-dates';

export const calendarDate = (change: EntityChange) =>
  (change.after ? change.afterEffectiveDate : change.beforeEffectiveDate) ?? null;

export function proposalWeeks<Change extends EntityChange>(
  changes: readonly Change[],
  weekStartsOn: WeekStartsOn,
) {
  const weeks = new Map<string | null, Change[]>();
  const byDate = [...changes].sort((a, b) =>
    (calendarDate(a) ?? '').localeCompare(calendarDate(b) ?? ''),
  );
  for (const change of byDate) {
    const date = calendarDate(change);
    const weekStart = date && startOfWeek(date, weekStartsOn);
    weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), change]);
  }
  return [...weeks].map(([weekStart, weekChanges]) => ({ weekStart, changes: weekChanges }));
}

export function planTitles(
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
