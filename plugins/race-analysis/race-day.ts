import type { CourseEstimate, CourseSection, RacePlan } from '@athlete-panel/contracts';

type RaceDay = Pick<RacePlan, 'startTime' | 'finishCutoff' | 'stations'>;
type Cutoff = RacePlan['finishCutoff'];

const secondsAfterMidnight = (time: string) =>
  Number(time.slice(0, 2)) * 3600 + Number(time.slice(3)) * 60;
const cutoffToSeconds = (cutoff: Cutoff) =>
  cutoff && cutoff.dayOffset * 86400 + secondsAfterMidnight(cutoff.time);
const sectionFraction = (section: CourseSection, fromMeters: number, toMeters: number) =>
  Math.max(
    0,
    (Math.min(toMeters, section.toMeters) - Math.max(fromMeters, section.fromMeters)) /
      (section.toMeters - section.fromMeters),
  );

export function stationArrivals(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  { startTime, finishCutoff, stations }: RaceDay,
) {
  const courseMeters = sections.at(-1)?.toMeters ?? null;
  const plannedStopSeconds = stations.reduce((sum, station) => sum + station.stopSeconds, 0);
  const movingSeconds = estimate && Math.max(0, estimate.seconds - plannedStopSeconds);
  const aimElapsedSecondsAt = (meters: number) =>
    estimate &&
    sections.reduce(
      (sum, section) =>
        sum + estimate.sectionSeconds[section.index]! * sectionFraction(section, 0, meters),
      0,
    );
  const arrival = (aimElapsedSeconds: number | null, cutoff: Cutoff) => {
    const elapsed =
      estimate && aimElapsedSeconds !== null
        ? {
            aimSeconds: aimElapsedSeconds,
            lowSeconds: (aimElapsedSeconds * estimate.lowSeconds) / estimate.seconds,
            highSeconds: (aimElapsedSeconds * estimate.highSeconds) / estimate.seconds,
          }
        : null;
    const start = startTime === null ? null : secondsAfterMidnight(startTime);
    const timeOfDay =
      elapsed && start !== null
        ? {
            aimSeconds: start + elapsed.aimSeconds,
            lowSeconds: start + elapsed.lowSeconds,
            highSeconds: start + elapsed.highSeconds,
          }
        : null;
    const cutoffSeconds = cutoffToSeconds(cutoff);
    return {
      elapsed,
      timeOfDay,
      cutoffSeconds,
      cutoffMarginSeconds:
        timeOfDay && cutoffSeconds !== null ? cutoffSeconds - timeOfDay.highSeconds : null,
    };
  };
  const stationsOnCourse = stations.filter(
    (station) => courseMeters === null || station.distanceMeters <= courseMeters,
  );
  const legBoundaryMeters = [
    0,
    ...stationsOnCourse.map((station) => station.distanceMeters),
    ...(courseMeters === null ? [] : [courseMeters]),
  ];
  const legs = legBoundaryMeters
    .slice(1)
    .map((toMeters, index) => ({ fromMeters: legBoundaryMeters[index]!, toMeters }))
    .filter((leg) => leg.toMeters > leg.fromMeters)
    .map(({ fromMeters, toMeters }) => {
      const touched = sections.filter(
        (section) => sectionFraction(section, fromMeters, toMeters) > 0,
      );
      const elapsed = estimate && aimElapsedSecondsAt(toMeters)! - aimElapsedSecondsAt(fromMeters)!;
      return {
        fromMeters,
        toMeters,
        ascentMeters:
          touched.length && touched.every((section) => section.ascentMeters !== null)
            ? touched.reduce(
                (sum, section) =>
                  sum + section.ascentMeters! * sectionFraction(section, fromMeters, toMeters),
                0,
              )
            : null,
        movingSeconds: elapsed === null ? null : (elapsed * movingSeconds!) / estimate!.seconds,
      };
    });
  return {
    stations: stations.map((station) => {
      const beyondCourse = courseMeters !== null && station.distanceMeters > courseMeters;
      return {
        station,
        beyondCourse,
        ...arrival(
          beyondCourse ? null : aimElapsedSecondsAt(station.distanceMeters),
          station.cutoff,
        ),
      };
    }),
    finish: { distanceMeters: courseMeters, ...arrival(estimate?.seconds ?? null, finishCutoff) },
    legs,
    plannedStopSeconds,
    movingSeconds,
    stopsExceedEstimate: !!estimate && plannedStopSeconds > estimate.seconds,
  };
}
