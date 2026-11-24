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

const sectionIndexAtDistance = (sections: readonly CourseSection[], meters: number) => {
  const position = sections.findIndex((section) => meters < section.toMeters);
  return position === -1 ? sections.length - 1 : position;
};

export function movingSeconds(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  stations: readonly Station[],
) {
  return estimate && Math.max(0, estimate.seconds - stopSecondsOnCourse(sections, stations));
}

export function adjustedEstimate(
  estimate: CourseEstimate | null,
  sections: readonly CourseSection[],
  planStations: readonly Station[],
  {
    effortPercent,
    weatherPercent,
    stations,
  }: Pick<RacePlan, 'effortPercent' | 'weatherPercent'> & { stations: readonly Station[] },
) {
  if (!estimate) return null;
  const factor = (1 + effortPercent / 100) * (1 + weatherPercent / 100);
  const planStopSeconds = new Map(planStations.map((station) => [station.id, station.stopSeconds]));
  const stopSecondsChanges = stations
    .filter((station) => !isBeyondCourse(station, sections))
    .map((station) => ({
      sectionIndex: sectionIndexAtDistance(sections, station.distanceMeters),
      seconds: station.stopSeconds - (planStopSeconds.get(station.id) ?? 0),
    }))
    .filter((change) => change.seconds !== 0);
  if (factor === 1 && stopSecondsChanges.length === 0) return estimate;
  const movingTimeFactor =
    1 + (movingSeconds(estimate, sections, planStations)! * (factor - 1)) / estimate.seconds;
  const sectionSeconds = estimate.sectionSeconds.map(
    (seconds, position) =>
      seconds * movingTimeFactor +
      stopSecondsChanges
        .filter((change) => change.sectionIndex === position)
        .reduce((sum, change) => sum + change.seconds, 0),
  );
  const seconds = sectionSeconds.reduce((sum, value) => sum + value, 0);
  return {
    ...estimate,
    seconds,
    lowSeconds: (estimate.lowSeconds * seconds) / estimate.seconds,
    highSeconds: (estimate.highSeconds * seconds) / estimate.seconds,
    sectionSeconds,
  };
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
