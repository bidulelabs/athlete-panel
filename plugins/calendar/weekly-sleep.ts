import { dateSchema, type HealthRecord } from '@athlete-panel/contracts';
import { addDays } from '../training/public/shared';
import { latestDailyHealth } from '../activity-records/public/shared';

export type WeeklySleep = {
  averageSeconds: number | null;
  recordedNights: number;
  elapsedNights: number;
  missingNights: number;
  upcomingNights: number;
  ambiguousNights: number;
};

export function weeklySleep(
  records: readonly HealthRecord[],
  weekStart: string,
  today: string,
): WeeklySleep {
  const { averageValue, ...coverage } = weeklyNightlyMetric(
    records,
    'sleepDurationSeconds',
    weekStart,
    today,
  );
  return { ...coverage, averageSeconds: averageValue };
}

export type WeeklyHrv = Omit<WeeklySleep, 'averageSeconds'> & {
  averageMilliseconds: number | null;
};
export function weeklyHrv(
  records: readonly HealthRecord[],
  weekStart: string,
  today: string,
): WeeklyHrv {
  const { averageValue, ...coverage } = weeklyNightlyMetric(
    records,
    'hrvMilliseconds',
    weekStart,
    today,
  );
  return { ...coverage, averageMilliseconds: averageValue };
}

function weeklyNightlyMetric(
  records: readonly HealthRecord[],
  metric: 'sleepDurationSeconds' | 'hrvMilliseconds',
  weekStart: string,
  today: string,
) {
  dateSchema.parse(weekStart);
  dateSchema.parse(today);
  const nights = latestDailyHealth(records).filter((record) => record.metric === metric);
  const values: number[] = [];
  let elapsedNights = 0,
    ambiguousNights = 0;
  for (let day = 0; day < 7; day++) {
    const date = addDays(weekStart, day);
    if (date > today) continue;
    elapsedNights++;
    // A corrected record is already resolved within its account. Never average two
    // accounts as two nights, or silently pick one when their dated totals overlap.
    const candidates = nights.filter((night) => night.localDate === date && night.value !== null);
    if (candidates.length === 1) values.push(candidates[0]!.value!);
    else if (candidates.length > 1) ambiguousNights++;
  }
  return {
    averageValue: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
    recordedNights: values.length,
    elapsedNights,
    missingNights: elapsedNights - values.length,
    upcomingNights: 7 - elapsedNights,
    ambiguousNights,
  };
}
