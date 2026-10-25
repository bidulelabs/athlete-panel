// A conservative scan boundary, not a Garmin retention guarantee. It predates
// Garmin's entry into fitness (2003); activity pagination has no lower bound.
// Keep empty health windows: absence in one period cannot prove history ended.
export const GARMIN_HEALTH_HISTORY_START = '2000-01-01';

export function automaticHealthHistoryStart(previous?: string): string {
  // Preserve an explicitly older legacy bound rather than narrowing its history.
  return previous && previous < GARMIN_HEALTH_HISTORY_START ? previous : GARMIN_HEALTH_HISTORY_START;
}
