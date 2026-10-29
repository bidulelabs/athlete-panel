import type { Workout } from '@athlete-panel/contracts';

/** Plan weeks are seven-day blocks from day 1, independent of calendar week preference. */
export function planWeeks(workouts: readonly Workout[]) {
  const weeks = new Map<number, Map<number, Workout[]>>();
  const ordered = [...workouts].sort((a, b) => {
    const day = (workout: Workout) => (workout.schedule.kind === 'plan' ? workout.schedule.day : 0);
    return day(a) - day(b) || a.order - b.order || a.id.localeCompare(b.id);
  });
  for (const workout of ordered) {
    if (workout.schedule.kind !== 'plan') continue;
    const day = workout.schedule.day;
    const week = Math.ceil(day / 7);
    if (!weeks.has(week)) weeks.set(week, new Map());
    const days = weeks.get(week)!;
    days.set(day, [...(days.get(day) ?? []), workout]);
  }
  return [...weeks].map(([week, days]) => ({ week, days: [...days] }));
}

export function plannedDuration(workouts: readonly Workout[]) {
  const sessions = workouts.filter((workout) => workout.kind !== 'rest');
  const known = sessions.filter((workout) => workout.durationSeconds !== null);
  return {
    seconds: known.length
      ? known.reduce((sum, workout) => sum + workout.durationSeconds!, 0)
      : null,
    missing: sessions.length - known.length,
    sessions: sessions.length,
    rests: workouts.length - sessions.length,
  };
}
