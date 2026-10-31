import { healthMetricSchema, type HealthRecord, type Profile } from '../../packages/contracts/src';
import { addDays } from '../training/public/shared';
import { latestDailyHealth } from '../activity-records/public/shared';
import { resolveWeekStartsOn, startOfWeek } from '../../packages/ui/src/calendar-dates';

const earlierDate = (a: string, b: string) => (a < b ? a : b);
const daysInRange = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86400000 + 1;

function weeklyAverages(records: HealthRecord[]) {
  const latestRecords = latestDailyHealth(records);
  return Object.fromEntries(
    healthMetricSchema.options.map((metric) => {
      const recordsWithValue = latestRecords.filter((r) => r.metric === metric && r.value !== null);
      const values = recordsWithValue
        .filter(
          (r) => recordsWithValue.filter((other) => other.localDate === r.localDate).length === 1,
        )
        .map((r) => r.value!);
      const average = values.length
        ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
        : null;
      return [metric, { average, days: values.length }];
    }),
  );
}

export function recentHealthAndWeeklyAverages(
  context: { profile: Profile | null; health: HealthRecord[] },
  scope: { from: string; to: string },
  today: string,
) {
  const firstDailyDate = addDays(today, -6);
  const lastWeeklyDate = earlierDate(addDays(firstDailyDate, -1), scope.to);
  const weekStartsOn = resolveWeekStartsOn(context.profile?.weekStartsOnPreference);
  const healthWeeks = [];
  for (let from = scope.from; from <= lastWeeklyDate;) {
    const to = earlierDate(addDays(startOfWeek(from, weekStartsOn), 6), lastWeeklyDate);
    healthWeeks.push({
      from,
      to,
      days: daysInRange(from, to),
      metrics: weeklyAverages(
        context.health.filter((r) => r.localDate >= from && r.localDate <= to),
      ),
    });
    from = addDays(to, 1);
  }
  return {
    health: context.health.filter((r) => r.localDate >= firstDailyDate),
    healthWeeks,
  };
}
