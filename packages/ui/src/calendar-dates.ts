import { dateSchema, type WeekStartsOnPreference } from '@athlete-panel/contracts';

export type WeekStartsOn = 0 | 1;
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** Match the legacy Sunday/Monday choices, with both Intl week-info API shapes. */
export function resolveWeekStartsOn(preference: WeekStartsOnPreference = 'auto', locale?: string): WeekStartsOn {
  if (preference === 'sunday') return 0;
  if (preference === 'monday' || !locale) return 1;
  try {
    const parsed = new Intl.Locale(locale.replaceAll('_', '-')) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = parsed.getWeekInfo?.().firstDay ?? parsed.weekInfo?.firstDay;
    if (firstDay === 7) return 0;
    if (firstDay === 1) return 1;
    // Older browsers may have Intl.Locale without week information.
    return parsed.region === 'US' ? 0 : 1;
  } catch {
    return /(?:^|-)US(?:-|$)/i.test(locale.replaceAll('_', '-')) ? 0 : 1;
  }
}

export function orderedWeekdays(weekStartsOn: WeekStartsOn) {
  return [...weekdays.slice(weekStartsOn), ...weekdays.slice(0, weekStartsOn)];
}

/** Floating calendar arithmetic must not cross browser timezones or DST offsets. */
export function addDays(date: string, days: number): string {
  dateSchema.parse(date);
  if (!Number.isSafeInteger(days)) throw new Error('Day offset must be an integer.');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateSchema.parse(value.toISOString().slice(0, 10));
}

export function startOfWeek(date: string, weekStartsOn: WeekStartsOn): string {
  dateSchema.parse(date);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday - weekStartsOn + 7) % 7));
}

export function localDate(date = new Date(), timezone?: string): string {
  if (!timezone) return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
