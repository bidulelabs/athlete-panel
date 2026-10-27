import type { WorkspaceState } from '@athlete-panel/contracts';

export interface CyclingMetric {
  value: number | null;
  knownCount: number;
  missingCount: number;
  sessions: number;
}
export interface SleepMetric {
  averageSeconds: number | null;
  recordedNights: number;
  missingNights: number;
}
const nextDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const total = (values: (number | null)[]): CyclingMetric => {
  const known = values.filter((value): value is number => value !== null);
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : values.length ? null : 0,
    knownCount: known.length,
    missingCount: values.length - known.length,
    sessions: values.length,
  };
};
const sleepTotal = (values: (number | null)[]): SleepMetric => {
  const known = values.filter((value): value is number => value !== null);
  return {
    averageSeconds: known.length
      ? known.reduce((sum, value) => sum + value, 0) / known.length
      : null,
    recordedNights: known.length,
    missingNights: values.length - known.length,
  };
};

export function summarizeCyclingSleep(
  data: Pick<WorkspaceState, 'activities' | 'workouts' | 'health'>,
  startDate: string,
  endDate: string,
) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = nextDate(date, 1)) dates.push(date);
  const cyclingValues = dates.map((date) => [
    ...data.activities
      .filter((activity) => activity.sport === 'cycling' && activity.localDate === date)
      .map((activity) => activity.durationSeconds),
    ...data.workouts
      .filter(
        (workout) =>
          workout.sport === 'cycling' &&
          workout.completion?.source === 'manual' &&
          workout.completion.status !== 'skipped' &&
          workout.completion.performedDate === date,
      )
      .map((workout) => workout.completion!.durationSeconds),
  ]);
  const dailyCycling = cyclingValues.map(total);
  const dailySleep = dates.map(
    (date) =>
      data.health.find(
        (record) => record.metric === 'sleepDurationSeconds' && record.localDate === date,
      )?.value ?? null,
  );
  const weeks = Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) => ({
    startDate: dates[index * 7]!,
    endDate: dates[Math.min(index * 7 + 6, dates.length - 1)]!,
    cycling: total(cyclingValues.slice(index * 7, index * 7 + 7).flat()),
    sleep: sleepTotal(dailySleep.slice(index * 7, index * 7 + 7)),
  }));
  return {
    dates,
    dailyCycling,
    dailySleep,
    cycling: total(cyclingValues.flat()),
    sleep: sleepTotal(dailySleep),
    weeks,
  };
}
