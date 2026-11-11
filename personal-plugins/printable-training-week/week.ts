import type { WorkspaceState } from '@athlete-panel/contracts';
import { addDays, startOfWeek, type WeekStartsOn } from '@athlete-panel/ui/calendar-dates';
import { effectiveDate } from '../../plugins/training/public/shared';

/** Print prescriptions on their scheduled dates, regardless of recorded completion. */
export function printableWeek(
  data: Pick<WorkspaceState, 'plans' | 'workouts'>,
  date: string,
  weekStartsOn: WeekStartsOn,
) {
  const start = startOfWeek(date, weekStartsOn);
  const scheduled = data.workouts.map((workout) => {
    const schedule = workout.schedule;
    return {
      workout,
      date: effectiveDate(workout, data.plans),
      planTitle:
        schedule.kind === 'plan'
          ? data.plans.find((plan) => plan.id === schedule.planId)?.title
          : undefined,
    };
  });
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(start, index);
    return {
      date: day,
      sessions: scheduled
        .filter((entry) => entry.date === day)
        .sort(
          (a, b) => a.workout.order - b.workout.order || a.workout.id.localeCompare(b.workout.id),
        ),
    };
  });
}
