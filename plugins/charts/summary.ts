import {
  chartsSports,
  isUnresolvedActivitySport,
  type ChartsSport,
  type ChartsSummary,
  type ChartsSummaryInput,
  type SportSelection,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import {
  addDays,
  weeklySummary,
  type MetricTotal,
  type SportBreakdown,
} from '../training/public/shared';

function addMetricTotals(a: MetricTotal, b: MetricTotal): MetricTotal {
  const knownCount = a.knownCount + b.knownCount;
  const missingCount = a.missingCount + b.missingCount;
  return {
    value: knownCount ? (a.value ?? 0) + (b.value ?? 0) : missingCount ? null : 0,
    knownCount,
    missingCount,
  };
}

const toChartsSport = (item: SportSelection & { sport: string }): ChartsSport =>
  !isUnresolvedActivitySport(item) && chartsSports.includes(item.sport as ChartsSport)
    ? (item.sport as ChartsSport)
    : 'other';

function sumBySport(
  breakdown: SportBreakdown[],
  measure: (recorded: SportBreakdown['actual']) => MetricTotal,
) {
  const bySport = Object.fromEntries(
    chartsSports.map((sport) => [sport, { value: 0, knownCount: 0, missingCount: 0 }]),
  ) as Record<ChartsSport, MetricTotal>;
  for (const entry of breakdown.filter((item) => item.sportSubgroup === null)) {
    const sport = toChartsSport(entry);
    bySport[sport] = addMetricTotals(bySport[sport], measure(entry.actual));
  }
  return bySport;
}

export function chartsSummary(
  state: WorkspaceState,
  { weekStart, weeks }: ChartsSummaryInput,
): ChartsSummary {
  const lastDay = addDays(weekStart, weeks * 7 - 1);
  return {
    weeks: Array.from({ length: weeks }, (_, index) => {
      const week = weeklySummary(state, addDays(weekStart, index * 7));
      return {
        weekStart: week.startDate,
        plannedSeconds: week.planned.durationSeconds,
        recordedSeconds: week.actual.durationSeconds,
        recordedSecondsBySport: sumBySport(
          week.sportBreakdown,
          (recorded) => recorded.durationSeconds,
        ),
        recordedElevationMetersBySport: sumBySport(
          week.sportBreakdown,
          (recorded) => recorded.elevationMeters,
        ),
        recordedRunningDistanceMeters: sumBySport(
          week.sportBreakdown,
          (recorded) => recorded.distanceMeters,
        ).running,
      };
    }),
    races: state.events
      .filter((event) => event.kind === 'race' && event.date >= weekStart && event.date <= lastDay)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(({ id, date, title }) => ({ id, date, title })),
    activities: state.activities
      .filter((activity) => activity.localDate >= weekStart && activity.localDate <= lastDay)
      .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.id.localeCompare(b.id))
      .map((activity) => ({
        id: activity.id,
        date: activity.localDate,
        title: activity.title,
        sport: toChartsSport(activity),
        averageHeartRateBpm: activity.averageHeartRateBpm,
        durationSeconds: activity.durationSeconds,
      })),
  };
}
