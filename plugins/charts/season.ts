import type { WorkspaceState } from '@athlete-panel/contracts';
import { effectiveDate } from '../training/public/shared';

export function seasonStart(
  { plans, workouts }: Pick<WorkspaceState, 'plans' | 'workouts'>,
  today: string,
) {
  const activePlanStarts = plans.flatMap((plan) => {
    const planDates = workouts
      .filter((workout) => workout.schedule.kind === 'plan' && workout.schedule.planId === plan.id)
      .map((workout) => effectiveDate(workout, plans)!);
    return plan.startDate && plan.startDate <= today && planDates.some((date) => date >= today)
      ? [plan.startDate]
      : [];
  });
  return activePlanStarts.sort().at(-1) ?? `${today.slice(0, 4)}-01-01`;
}
