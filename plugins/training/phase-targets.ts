import {
  editedWeekStartsInside,
  type EditedWeek,
  type Period,
  type WeeklyTarget,
} from '@athlete-panel/contracts';
import { addDays, mondayOf } from './dates';

export type TargetRange = WeeklyTarget['firstWeek'];
export type WeekTargets = Record<
  'weeklyDurationSeconds' | 'weeklyDistanceMeters' | 'weeklyElevationGainMeters',
  TargetRange | null
>;

const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function editedWeeksInside(
  period: Period,
  startDate = period.startDate,
  endDate = period.endDate,
) {
  return Object.fromEntries(
    Object.entries(period.editedWeeks).filter(([monday]) =>
      editedWeekStartsInside(monday, startDate, endDate),
    ),
  );
}

export const editedWeekMonday = (weekStart: string) => mondayOf(addDays(weekStart, 1));

export const findEditedWeek = (period: Period, weekStart: string): EditedWeek | undefined =>
  period.editedWeeks[editedWeekMonday(weekStart)];

export function editedWeeksWith(period: Period, weekStart: string, editedWeek: EditedWeek | null) {
  const monday = editedWeekMonday(weekStart);
  const others = Object.entries(period.editedWeeks).filter(([key]) => key !== monday);
  return Object.fromEntries(editedWeek ? [...others, [monday, editedWeek]] : others);
}

export function phaseWeekStarts(period: Period, firstDayOfWeek: (date: string) => string) {
  const weekStarts: string[] = [];
  const aligned = firstDayOfWeek(period.startDate);
  for (
    let weekStart = aligned < period.startDate ? addDays(aligned, 7) : aligned;
    weekStart <= period.endDate;
    weekStart = addDays(weekStart, 7)
  )
    weekStarts.push(weekStart);
  return weekStarts;
}

export function weekTargets(periods: readonly Period[], weekStart: string): WeekTargets | null {
  const period = periods.find((item) => item.startDate <= weekStart && weekStart <= item.endDate);
  if (!period) return null;
  const edited = findEditedWeek(period, weekStart);
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
    weeklyDurationSeconds: edited?.weeklyDurationSeconds ?? atWeek(period.weeklyDurationSeconds),
    weeklyDistanceMeters: edited?.weeklyDistanceMeters ?? atWeek(period.weeklyDistanceMeters),
    weeklyElevationGainMeters:
      edited?.weeklyElevationGainMeters ?? atWeek(period.weeklyElevationGainMeters),
  };
}

export function targetRangeLabel(target: TargetRange | null, format: (value: number) => string) {
  if (!target) return 'No target';
  return format(target.min) === format(target.max)
    ? format(target.min)
    : `${format(target.min)}–${format(target.max)}`;
}
