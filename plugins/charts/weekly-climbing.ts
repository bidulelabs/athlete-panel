import {
  chartsSports,
  type ChartsBucket,
  type ChartsSport,
  type ChartsSummary,
  type Profile,
} from '@athlete-panel/contracts';
import { targetRangeLabel, type MetricTotal } from '../training/public/shared';
import { perSport } from './training-by-sport';
import { sessionCount, trainingHoursBuckets, type TrainingHoursBucket } from './training-hours';

export type UnitSystem = Profile['units'];
export type ClimbingBucket = TrainingHoursBucket & {
  sessionSports: ChartsSport[];
  elevationBySport: Record<ChartsSport, number | null>;
  elevationLabelBySport: Record<ChartsSport, string>;
  runningClimb: number | null;
  runningClimbLabel: string;
};

const feetPerMeter = 3.28084;
export const elevationUnitLabel = (units: UnitSystem) => (units === 'imperial' ? 'ft' : 'm');
export const climbUnitLabel = (units: UnitSystem) => (units === 'imperial' ? 'ft/mi' : 'm/km');

function elevationLabel(measure: MetricTotal, units: UnitSystem) {
  if (measure.value === null) return 'Elevation missing';
  const elevation = `${Math.round(measure.value * (units === 'imperial' ? feetPerMeter : 1)).toLocaleString('en-GB')} ${elevationUnitLabel(units)}`;
  if (!measure.missingCount) return elevation;
  return `${elevation} (${measure.missingCount} of ${sessionCount(measure)} sessions without elevation)`;
}

function measureRunningClimb(climb: ChartsBucket['runningClimb'], units: UnitSystem) {
  if (!climb.sessionCount) return { value: null, label: 'No running' };
  if (!climb.measuredSessionCount) return { value: null, label: 'Not measured' };
  const value =
    units === 'imperial'
      ? (climb.elevationMeters * feetPerMeter) / (climb.distanceMeters / 1609.344)
      : climb.elevationMeters / (climb.distanceMeters / 1000);
  const partial = climb.measuredSessionCount < climb.sessionCount ? ' (partial)' : '';
  return { value, label: `${Math.round(value)} ${climbUnitLabel(units)}${partial}` };
}

export const sportsWithElevation = (summary: ChartsSummary) =>
  chartsSports.filter((sport) =>
    (summary.volume?.buckets ?? []).some(
      (week) => week.recordedElevationMetersBySport[sport].knownCount > 0,
    ),
  );

export function climbingBuckets(
  summary: ChartsSummary,
  today: string,
  units: UnitSystem,
): ClimbingBucket[] {
  const sports = sportsWithElevation(summary);
  return trainingHoursBuckets(summary, today, String).map((week, index) => {
    const { recordedElevationMetersBySport, runningClimb, targetElevationMeters } =
      summary.volume!.buckets[index]!;
    const toUnits = (meters: number) => meters * (units === 'imperial' ? feetPerMeter : 1);
    const upcoming = week.startDate > today;
    const noSessions = (sport: ChartsSport) =>
      sessionCount(recordedElevationMetersBySport[sport]) === 0;
    const climb = measureRunningClimb(runningClimb, units);
    return {
      ...week,
      sessionSports: sports.filter(
        (sport) => sessionCount(recordedElevationMetersBySport[sport]) > 0,
      ),
      elevationBySport: perSport((sport) => {
        const meters = recordedElevationMetersBySport[sport].value;
        return upcoming || noSessions(sport) || meters === null
          ? null
          : meters * (units === 'imperial' ? feetPerMeter : 1);
      }),
      elevationLabelBySport: perSport((sport) =>
        upcoming
          ? 'Upcoming'
          : noSessions(sport)
            ? 'No sessions recorded'
            : elevationLabel(recordedElevationMetersBySport[sport], units),
      ),
      targetRange: targetElevationMeters && [
        toUnits(targetElevationMeters.min),
        toUnits(targetElevationMeters.max),
      ],
      targetLabel: targetRangeLabel(
        targetElevationMeters,
        (meters) =>
          `${Math.round(toUnits(meters)).toLocaleString('en-GB')} ${elevationUnitLabel(units)}`,
      ),
      runningClimb: upcoming ? null : climb.value,
      runningClimbLabel: upcoming ? 'Upcoming' : climb.label,
    };
  });
}
