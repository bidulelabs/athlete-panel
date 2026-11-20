import { addCalendarYears, type TrainingEvent } from '@athlete-panel/contracts';

/** Invert the forward anniversary limit: on leap day, a clamped start may need March 1. */
export function historyAnniversaryStart(today: string, years: 1 | 5): string {
  const start = addCalendarYears(today, -years);
  return addCalendarYears(start, years) < today ? `${start.slice(0, 4)}-03-01` : start;
}

export const racesUpToOneYearAhead = (events: readonly TrainingEvent[], today: string) =>
  events
    .filter(
      (event) =>
        event.kind === 'race' && event.date >= today && event.date <= addCalendarYears(today, 1),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
