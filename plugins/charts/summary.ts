import {
  chartsLongLoadAverageDays,
  chartsUsualRangeLookbackNights,
  chartsSports,
  isChartsVolumeTemplate,
  isUnresolvedActivitySport,
  type ChartsNight,
  type ChartsSport,
  type ChartsSummary,
  type ChartsSummaryInput,
  type SportSelection,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import {
  addDays,
  weeklySummary,
  summarizeRange,
  type MetricTotal,
  type SportBreakdown,
} from '../training/public/shared';
import { bucketRanges } from './bucket-ranges';

function addMetricTotals(a: MetricTotal, b: MetricTotal): MetricTotal {
  const knownCount = a.knownCount + b.knownCount;
  const missingCount = a.missingCount + b.missingCount;
  return {
    value: knownCount ? (a.value ?? 0) + (b.value ?? 0) : missingCount ? null : 0,
    knownCount,
    missingCount,
  };
}

const toChartsSport = (item: SportSelection): ChartsSport =>
  !isUnresolvedActivitySport(item) && chartsSports.includes(item.sport as ChartsSport)
    ? (item.sport as ChartsSport)
    : 'other';

function sumBySport(
  breakdown: SportBreakdown[],
  measure: (recorded: SportBreakdown['actual']) => MetricTotal,
  source: 'actual' | 'planned' = 'actual',
  sports: readonly ChartsSport[] = chartsSports,
) {
  const bySport = Object.fromEntries(
    chartsSports.map((sport) => [sport, { value: 0, knownCount: 0, missingCount: 0 }]),
  ) as Record<ChartsSport, MetricTotal>;
  for (const entry of breakdown.filter((item) => item.sportSubgroup === null)) {
    const sport = toChartsSport(entry);
    if (sports.includes(sport))
      bySport[sport] = addMetricTotals(bySport[sport], measure(entry[source]));
  }
  return bySport;
}

type CalendarWeek = ReturnType<typeof weeklySummary>;

function nightsBetween(health: WorkspaceState['health'], from: string, to: string): ChartsNight[] {
  const byDate = new Map<string, ChartsNight>();
  for (const record of health) {
    if (record.localDate < from || record.localDate > to || record.value === null) continue;
    if (record.metric !== 'restingHeartRateBpm' && record.metric !== 'hrvMilliseconds') continue;
    const night = byDate.get(record.localDate) ?? {
      date: record.localDate,
      restingHeartRateBpm: null,
      restingHeartRateMayBeMinimum: false,
      hrvMilliseconds: null,
    };
    night[record.metric] = record.value;
    if (record.metric === 'restingHeartRateBpm')
      night.restingHeartRateMayBeMinimum = record.provenance?.restingHeartRateMayBeMinimum ?? false;
    byDate.set(record.localDate, night);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function chartsSummary(
  state: WorkspaceState,
  { template, weekStart, weeks, grouping = 'week', sports = [...chartsSports] }: ChartsSummaryInput,
): ChartsSummary {
  const lastDay = addDays(weekStart, weeks * 7 - 1);
  const activitiesById = new Map(state.activities.map((activity) => [activity.id, activity]));
  const workoutsById = new Map(state.workouts.map((workout) => [workout.id, workout]));
  const recordedSessions = (week: CalendarWeek) =>
    week.recordedSessions.map((session) => {
      const activity = session.kind === 'activity' ? activitiesById.get(session.id)! : null;
      const completion = activity ? null : workoutsById.get(session.id)!.completion!;
      return {
        id: session.id,
        date: session.localDate,
        title: session.title,
        sport: toChartsSport(activity ?? workoutsById.get(session.id)!),
        averageHeartRateBpm: activity?.averageHeartRateBpm ?? null,
        durationSeconds: session.durationSeconds,
        distanceMeters: activity ? activity.distanceMeters : completion!.distanceMeters,
        elevationMeters: activity?.elevationMeters ?? null,
      };
    });
  const calendarWeeks = Array.from({ length: weeks }, (_, index) =>
    weeklySummary(state, addDays(weekStart, index * 7)),
  );
  const project = (period: CalendarWeek, selected: readonly ChartsSport[] = chartsSports) => {
    const recordedSecondsBySport = sumBySport(
      period.sportBreakdown,
      (value) => value.durationSeconds,
      'actual',
      selected,
    );
    const plannedBySport = sumBySport(
      period.sportBreakdown,
      (value) => value.durationSeconds,
      'planned',
      selected,
    );
    const sum = (values: Record<ChartsSport, MetricTotal>) =>
      Object.values(values).reduce(addMetricTotals, { value: 0, knownCount: 0, missingCount: 0 });
    const runs = selected.includes('running')
      ? recordedSessions(period).filter((session) => session.sport === 'running')
      : [];
    const measuredRuns = runs.filter((run) => run.elevationMeters !== null && !!run.distanceMeters);
    return {
      plannedSeconds: sum(plannedBySport),
      recordedSeconds: sum(recordedSecondsBySport),
      recordedSecondsBySport,
      recordedElevationMetersBySport: sumBySport(
        period.sportBreakdown,
        (value) => value.elevationMeters,
        'actual',
        selected,
      ),
      runningClimb: {
        sessionCount: runs.length,
        measuredSessionCount: measuredRuns.length,
        elevationMeters: measuredRuns.reduce((sum, run) => sum + run.elevationMeters!, 0),
        distanceMeters: measuredRuns.reduce((sum, run) => sum + run.distanceMeters!, 0),
      },
    };
  };
  return {
    weeks: calendarWeeks.map((week) => ({ weekStart: week.startDate, ...project(week) })),
    volume: isChartsVolumeTemplate(template)
      ? {
          grouping,
          sports: chartsSports.filter((sport) => sports.includes(sport)),
          buckets: bucketRanges(weekStart, weeks, grouping).map((range, index) => ({
            ...range,
            ...project(
              grouping === 'week' ? calendarWeeks[index]! : summarizeRange(state, range),
              sports,
            ),
          })),
        }
      : null,
    races: state.events
      .filter((event) => event.kind === 'race' && event.date >= weekStart && event.date <= lastDay)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(({ id, date, title }) => ({ id, date, title })),
    sessions: calendarWeeks
      .flatMap(recordedSessions)
      .map(({ id, date, title, sport, averageHeartRateBpm, durationSeconds }) => ({
        id,
        date,
        title,
        sport,
        averageHeartRateBpm,
        durationSeconds,
      })),
    nights: nightsBetween(
      state.health,
      addDays(weekStart, -chartsUsualRangeLookbackNights),
      lastDay,
    ),
    trainingLoadSessions:
      template === 'estimated-training-load'
        ? [
            ...Array.from({ length: chartsLongLoadAverageDays / 7 }, (_, index) =>
              weeklySummary(state, addDays(weekStart, (index - chartsLongLoadAverageDays / 7) * 7)),
            ),
            ...calendarWeeks,
          ]
            .flatMap(recordedSessions)
            .filter((session) => session.date >= addDays(weekStart, 1 - chartsLongLoadAverageDays))
            .map(({ date, averageHeartRateBpm, durationSeconds }) => ({
              date,
              averageHeartRateBpm,
              durationSeconds,
            }))
        : [],
  };
}
