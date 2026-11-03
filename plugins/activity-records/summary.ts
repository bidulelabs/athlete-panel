import type { Activity } from '@athlete-panel/contracts';

type ActivityMeasurements = Pick<Activity, 'durationSeconds' | 'distanceMeters'>;

export function activityMetricSummary(
  activities: readonly ActivityMeasurements[],
  metric: keyof ActivityMeasurements,
) {
  let total = 0;
  let knownCount = 0;
  for (const activity of activities) {
    const value = activity[metric];
    if (value != null) {
      total += value;
      knownCount++;
    }
  }
  return {
    value: knownCount ? total : null,
    knownCount,
    missingCount: activities.length - knownCount,
  };
}
