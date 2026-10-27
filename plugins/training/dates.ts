import { dateSchema, type Plan, type Schedule, type Workout } from '@athlete-panel/contracts';

/** Floating dates are calculated in UTC; no viewer/server timezone participates. */
export function addDays(date: string, days: number): string {
  dateSchema.parse(date);
  if (!Number.isSafeInteger(days)) throw new Error('Day offset must be an integer.');
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return dateSchema.parse(result.toISOString().slice(0, 10));
}

export function scheduleDate(schedule: Schedule, plans: readonly Plan[]): string | null {
  if (schedule.kind === 'independent') return schedule.date;
  const plan = plans.find((candidate) => candidate.id === schedule.planId);
  return plan?.startDate ? addDays(plan.startDate, schedule.day - 1) : null;
}

export function effectiveDate(
  item: Pick<Workout, 'schedule'> | Schedule,
  plans: readonly Plan[],
): string | null {
  return scheduleDate('schedule' in item ? item.schedule : item, plans);
}

export function activityLocalDate(startedAt: string, offsetSeconds: number): string {
  const milliseconds = Date.parse(startedAt);
  if (
    !Number.isFinite(milliseconds) ||
    !Number.isFinite(offsetSeconds) ||
    Math.abs(offsetSeconds) > 86400
  )
    throw new Error('Invalid activity timestamp or offset.');
  return dateSchema.parse(new Date(milliseconds + offsetSeconds * 1000).toISOString().slice(0, 10));
}

export function mondayOf(date: string): string {
  dateSchema.parse(date);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function distanceToMeters(value: number, units: 'metric' | 'imperial'): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Distance must be a finite nonnegative number.');
  return value * (units === 'imperial' ? 1609.344 : 1000);
}

export function distanceFromMeters(value: number, units: 'metric' | 'imperial'): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Distance must be a finite nonnegative number.');
  return value / (units === 'imperial' ? 1609.344 : 1000);
}
