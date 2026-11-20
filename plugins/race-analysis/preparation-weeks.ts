import type { WorkspaceState } from '@athlete-panel/contracts';
import { addDays, weekTargets, weeklySummary } from '../training/public/shared';

export function weeksUntilRace(
  data: WorkspaceState,
  today: string,
  currentWeekStart: string,
  raceDate: string,
) {
  if (raceDate < today) return [];
  const weeks = [];
  for (let weekStart = currentWeekStart; weekStart <= raceDate; weekStart = addDays(weekStart, 7)) {
    const { planned } = weeklySummary(data, weekStart);
    weeks.push({
      weekStart,
      phaseName:
        data.periods.find((period) => period.startDate <= weekStart && weekStart <= period.endDate)
          ?.name ?? null,
      weeklyDurationTarget: weekTargets(data.periods, weekStart)?.weeklyDurationSeconds ?? null,
      plannedSessions: planned.sessions,
      plannedDurationSeconds: planned.durationSeconds.value,
    });
  }
  return weeks;
}
