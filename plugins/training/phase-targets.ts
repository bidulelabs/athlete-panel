import type { Period, WeeklyTarget } from '@athlete-panel/contracts';
import { addDays } from './dates';

export type TargetRange = WeeklyTarget['firstWeek'];
export type WeekTargets = Record<
  'weeklyDurationSeconds' | 'weeklyDistanceMeters' | 'weeklyElevationGainMeters',
  TargetRange | null
>;

const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function weekTargets(periods: readonly Period[], weekStart: string): WeekTargets | null {
  const period = periods.find((item) => item.startDate <= weekStart && weekStart <= item.endDate);
  if (!period) return null;
  const firstWeekStart = addDays(period.startDate, daysFrom(period.startDate, weekStart) % 7);
  const lastWeekIndex = Math.floor(daysFrom(firstWeekStart, period.endDate) / 7);
  const progress = lastWeekIndex ? daysFrom(firstWeekStart, weekStart) / 7 / lastWeekIndex : 0;
  const between = (first: number, last: number) => first + (last - first) * progress;
  const atWeek = (target: WeeklyTarget | null) =>
    target && {
      min: between(target.firstWeek.min, target.lastWeek.min),
      max: between(target.firstWeek.max, target.lastWeek.max),
    };
  return {
    weeklyDurationSeconds: atWeek(period.weeklyDurationSeconds),
    weeklyDistanceMeters: atWeek(period.weeklyDistanceMeters),
    weeklyElevationGainMeters: atWeek(period.weeklyElevationGainMeters),
  };
}
