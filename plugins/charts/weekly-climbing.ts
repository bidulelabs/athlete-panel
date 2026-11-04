import {
  chartsSports,
  type ChartsSport,
  type ChartsSummary,
  type Profile,
} from '@athlete-panel/contracts';
import { type MetricTotal } from '../training/public/shared';
import { perSport } from './training-by-sport';
import { sessionCount, trainingHoursWeeks, type TrainingHoursWeek } from './training-hours';

export type UnitSystem = Profile['units'];
export type ClimbingWeek = TrainingHoursWeek & {
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

function measureRunningClimb(elevation: MetricTotal, distance: MetricTotal, units: UnitSystem) {
  if (!sessionCount(distance)) return { value: null, label: 'No running' };
  if (elevation.value === null || !distance.value) return { value: null, label: 'Not measured' };
  const value =
    units === 'imperial'
      ? (elevation.value * feetPerMeter) / (distance.value / 1609.344)
      : elevation.value / (distance.value / 1000);
  const partial = elevation.missingCount || distance.missingCount ? ' (partial)' : '';
  return { value, label: `${Math.round(value)} ${climbUnitLabel(units)}${partial}` };
}

export const sportsWithElevation = (summary: ChartsSummary) =>
  chartsSports.filter((sport) =>
    summary.weeks.some((week) => week.recordedElevationMetersBySport[sport].knownCount > 0),
  );

export function climbingWeeks(
  summary: ChartsSummary,
  today: string,
  units: UnitSystem,
): ClimbingWeek[] {
  const sports = sportsWithElevation(summary);
  return trainingHoursWeeks(summary, today, String).map((week, index) => {
    const { recordedElevationMetersBySport, recordedRunningDistanceMeters } = summary.weeks[index]!;
    const upcoming = week.weekStart > today;
    const noSessions = (sport: ChartsSport) =>
      sessionCount(recordedElevationMetersBySport[sport]) === 0;
    const climb = measureRunningClimb(
      recordedElevationMetersBySport.running,
      recordedRunningDistanceMeters,
      units,
    );
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
            ? 'No sessions'
            : elevationLabel(recordedElevationMetersBySport[sport], units),
      ),
      runningClimb: upcoming ? null : climb.value,
      runningClimbLabel: upcoming ? 'Upcoming' : climb.label,
    };
  });
}
