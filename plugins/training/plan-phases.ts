import type { Period, Plan } from '@athlete-panel/contracts';
import { addDays } from './dates';

export function planPhases(plan: Plan, plans: readonly Plan[], periods: readonly Period[]) {
  const start = plan.startDate;
  if (!start) return [];
  const nextPlanStart = plans
    .map((other) => other.startDate)
    .filter((date): date is string => date !== null && date > start)
    .sort()[0];
  return periods
    .filter(
      (period) => period.endDate >= start && (!nextPlanStart || period.startDate < nextPlanStart),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function planSections(phases: readonly Period[], plan: Plan, weeks: readonly number[]) {
  const sections: Array<{ phase: Period | null; weeks: number[] }> = [];
  let nextPhase = 0;
  for (const week of weeks) {
    const firstDay = plan.startDate ? addDays(plan.startDate, (week - 1) * 7) : null;
    while (firstDay && phases[nextPhase] && phases[nextPhase]!.startDate <= firstDay)
      sections.push({ phase: phases[nextPhase++]!, weeks: [] });
    const last = sections.at(-1);
    const insideLast = last && (last.phase === null || firstDay! <= last.phase.endDate);
    if (insideLast) last.weeks.push(week);
    else sections.push({ phase: null, weeks: [week] });
  }
  for (const phase of phases.slice(nextPhase)) sections.push({ phase, weeks: [] });
  return sections;
}
