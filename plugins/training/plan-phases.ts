import { editedWeekStartsInside, type Period, type Plan } from '@athlete-panel/contracts';
import { addDays, mondayOf } from './dates';
import { daysFrom, phaseWeekStarts } from './phase-targets';

export function nextPlanStart(plan: Plan, plans: readonly Plan[]) {
  return plans
    .map((other) => other.startDate)
    .filter((date): date is string => date !== null && date > plan.startDate!)
    .sort()[0];
}

export function planPhases(plan: Plan, plans: readonly Plan[], periods: readonly Period[]) {
  const start = plan.startDate;
  if (!start) return [];
  const end = nextPlanStart(plan, plans);
  return periods
    .filter((period) => period.endDate >= start && (!end || period.startDate < end))
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

export type PhaseWeekRow = {
  firstDay: string;
  planWeek: number | null;
  targetWeekStart: string | null;
};

export function phaseWeekRows(
  phase: Period,
  plan: Plan,
  plans: readonly Plan[],
  writtenWeeks: readonly number[],
  firstDayOfWeek: (date: string) => string,
): PhaseWeekRow[] {
  const start = plan.startDate!;
  const end = nextPlanStart(plan, plans);
  const rows = new Map<string, PhaseWeekRow>();
  for (const week of writtenWeeks) {
    const firstDay = addDays(start, (week - 1) * 7);
    rows.set(firstDay, { firstDay, planWeek: week, targetWeekStart: null });
  }
  for (const weekStart of phaseWeekStarts(phase, firstDayOfWeek)) {
    if (addDays(weekStart, 6) < start || (end && weekStart >= end)) continue;
    const days = daysFrom(start, weekStart);
    rows.set(weekStart, {
      firstDay: weekStart,
      planWeek: days >= 0 && days % 7 === 0 ? days / 7 + 1 : null,
      targetWeekStart: weekStart,
    });
  }
  return [...rows.values()].sort((a, b) => a.firstDay.localeCompare(b.firstDay));
}

export function planPhasesOnMove(plan: Plan, plans: readonly Plan[], periods: readonly Period[]) {
  const others = plans.filter((other) => other.id !== plan.id);
  const sharedWith = (phase: Period) =>
    others.filter((other) => planPhases(other, plans, periods).includes(phase));
  const phases = planPhases(plan, plans, periods);
  return {
    onlyThisPlan: phases.filter((phase) => !sharedWith(phase).length),
    shared: phases
      .map((phase) => ({ phase, plans: sharedWith(phase) }))
      .filter((entry) => entry.plans.length),
  };
}

export function movePhase(phase: Period, days: number) {
  const startDate = addDays(phase.startDate, days);
  const endDate = addDays(phase.endDate, days);
  const editedWeeks = Object.entries(phase.editedWeeks).map(
    ([monday, week]) => [mondayOf(addDays(monday, days)), week] as const,
  );
  const kept = editedWeeks.filter(([monday]) => editedWeekStartsInside(monday, startDate, endDate));
  return {
    values: { startDate, endDate, editedWeeks: Object.fromEntries(kept) },
    droppedEditedWeeks: Object.keys(phase.editedWeeks).filter(
      (_, index) => !kept.includes(editedWeeks[index]!),
    ),
  };
}
