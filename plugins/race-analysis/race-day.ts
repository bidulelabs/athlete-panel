import type { CourseEstimate, CourseSection, RacePlan } from '@athlete-panel/contracts';

type RaceDay = Pick<RacePlan, 'startTime' | 'finishCutoff' | 'stations'>;
type Station = RacePlan['stations'][number];
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
const courseLength = (sections: readonly CourseSection[]) => sections.at(-1)?.toMeters ?? null;
const isBeyondCourse = (station: Station, sections: readonly CourseSection[]) => {
  const courseMeters = courseLength(sections);
  return courseMeters !== null && station.distanceMeters > courseMeters;
};
const stopSecondsOnCourse = (sections: readonly CourseSection[], stations: readonly Station[]) =>
  stations
    .filter((station) => !isBeyondCourse(station, sections))
    .reduce((sum, station) => sum + station.stopSeconds, 0);

export function movingSeconds(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  stations: readonly Station[],
) {
  return estimate && Math.max(0, estimate.seconds - stopSecondsOnCourse(sections, stations));
}

export function stationArrivals(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  { startTime, finishCutoff, stations }: RaceDay,
) {
  const courseMeters = courseLength(sections);
  const plannedStopSeconds = stopSecondsOnCourse(sections, stations);
  const totalMovingSeconds = movingSeconds(estimate, sections, stations);
  const startSeconds = startTime === null ? null : secondsAfterMidnight(startTime);
  const secondsBetween = (fromMeters: number, toMeters: number) =>
    estimate &&
    sections.reduce(
      (sum, section) =>
        sum +
        estimate.sectionSeconds[section.index]! * sectionFraction(section, fromMeters, toMeters),
      0,
    );
  const arrivalRange = (secondsFromStart: number, offsetSeconds: number) => ({
    seconds: offsetSeconds + secondsFromStart,
    lowSeconds: offsetSeconds + (secondsFromStart * estimate!.lowSeconds) / estimate!.seconds,
    highSeconds: offsetSeconds + (secondsFromStart * estimate!.highSeconds) / estimate!.seconds,
  });
  const arrival = (secondsFromStart: number | null, cutoff: Cutoff) => {
    const timeOfDay =
      secondsFromStart !== null && startSeconds !== null
        ? arrivalRange(secondsFromStart, startSeconds)
        : null;
    const cutoffSeconds = cutoffToSeconds(cutoff);
    return {
      fromStart: secondsFromStart === null ? null : arrivalRange(secondsFromStart, 0),
      timeOfDay,
      cutoffSeconds,
      cutoffMarginSeconds:
        timeOfDay && cutoffSeconds !== null ? cutoffSeconds - timeOfDay.highSeconds : null,
    };
  };
  const legBoundaryMeters = [
    0,
    ...stations
      .filter((station) => !isBeyondCourse(station, sections))
      .map((station) => station.distanceMeters),
    ...(courseMeters === null ? [] : [courseMeters]),
  ];
  const legs = legBoundaryMeters
    .slice(1)
    .map((toMeters, index) => ({ fromMeters: legBoundaryMeters[index]!, toMeters }))
    .filter((leg) => leg.toMeters > leg.fromMeters)
    .map(({ fromMeters, toMeters }) => {
      const legSections = sections.filter(
        (section) => sectionFraction(section, fromMeters, toMeters) > 0,
      );
      const legSeconds = secondsBetween(fromMeters, toMeters);
      return {
        fromMeters,
        toMeters,
        ascentMeters:
          legSections.length && legSections.every((section) => section.ascentMeters !== null)
            ? legSections.reduce(
                (sum, section) =>
                  sum + section.ascentMeters! * sectionFraction(section, fromMeters, toMeters),
                0,
              )
            : null,
        movingSeconds:
          legSeconds === null ? null : (legSeconds * totalMovingSeconds!) / estimate!.seconds,
      };
    });
  return {
    stations: stations.map((station) => {
      const beyondCourse = isBeyondCourse(station, sections);
      return {
        station,
        beyondCourse,
        ...arrival(beyondCourse ? null : secondsBetween(0, station.distanceMeters), station.cutoff),
      };
    }),
    finish: { distanceMeters: courseMeters, ...arrival(estimate?.seconds ?? null, finishCutoff) },
    legs,
    plannedStopSeconds,
    movingSeconds: totalMovingSeconds,
    stopsExceedEstimate: !!estimate && plannedStopSeconds > estimate.seconds,
  };
}

export type RaceDayTiming = ReturnType<typeof stationArrivals>;
export type StopArrival = Omit<RaceDayTiming['finish'], 'distanceMeters'>;
