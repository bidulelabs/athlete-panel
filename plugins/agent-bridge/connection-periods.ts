import { addCalendarYears } from '@athlete-panel/contracts';

/** Invert the forward anniversary limit: on leap day, a clamped start may need March 1. */
export function historyAnniversaryStart(today: string, years: 1 | 5): string {
  const start = addCalendarYears(today, -years);
  return addCalendarYears(start, years) < today ? `${start.slice(0, 4)}-03-01` : start;
}
