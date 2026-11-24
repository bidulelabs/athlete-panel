import { describe, expect, it } from 'vitest';
import type { CourseEstimate, CourseSection, RacePlan } from '@athlete-panel/contracts';
import {
  adjustedEstimate,
  movingSeconds,
  stationArrivals,
} from '../../plugins/race-analysis/race-day';
import { clockTime } from '../../plugins/race-analysis/presentation';

type Station = RacePlan['stations'][number];
const section = (index: number, ascentMeters: number | null): CourseSection => ({
  index,
  fromMeters: index * 5000,
  toMeters: (index + 1) * 5000,
  ascentMeters,
  descentMeters: 0,
});
const sections = [section(0, 300), section(1, 300), section(2, null)];
const estimate = {
  seconds: 6000,
  lowSeconds: 4800,
  highSeconds: 7200,
  sectionSeconds: [1000, 2000, 3000],
} as CourseEstimate;
const station = (
  number: number,
  distanceMeters: number,
  values: Partial<Station> = {},
): Station => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name: `Synthetic station ${number}`,
  distanceMeters,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: false,
  ...values,
});
const stations = [
  station(1, 2500, { cutoff: { dayOffset: 0, time: '08:00' } }),
  station(2, 10000, { stopSeconds: 600 }),
  station(3, 20000),
];
const raceDay = {
  startTime: '07:00',
  finishCutoff: { dayOffset: 1, time: '00:30' },
  stations,
};
const sevenAm = 7 * 3600;

describe('station arrivals', () => {
  it('spreads the estimate over each section by distance, with the range and cutoff margin', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day.stations[0]).toMatchObject({
      beyondCourse: false,
      fromStart: { seconds: 500, lowSeconds: 400, highSeconds: 600 },
      timeOfDay: { seconds: sevenAm + 500, highSeconds: sevenAm + 600 },
      cutoffSeconds: 8 * 3600,
      cutoffMarginSeconds: 8 * 3600 - sevenAm - 600,
    });
    expect(day.stations[1]).toMatchObject({
      fromStart: { seconds: 3000 },
      cutoffSeconds: null,
      cutoffMarginSeconds: null,
    });
  });

  it('counts a finish cutoff on the next day from race-day midnight', () => {
    const { finish } = stationArrivals(estimate, sections, raceDay);
    expect(finish).toMatchObject({
      distanceMeters: 15000,
      fromStart: { seconds: 6000, highSeconds: 7200 },
      cutoffSeconds: 86400 + 1800,
      cutoffMarginSeconds: 86400 + 1800 - sevenAm - 7200,
    });
  });

  it('flags a station beyond the course without an arrival, and keeps the others', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day.stations.map((row) => row.beyondCourse)).toEqual([false, false, true]);
    expect(day.stations[2]).toMatchObject({
      fromStart: null,
      timeOfDay: null,
      cutoffMarginSeconds: null,
    });
  });

  it('subtracts only the stops of stations on the course from the estimate, per leg and in total', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day).toMatchObject({
      plannedStopSeconds: 900,
      movingSeconds: 5100,
      stopsExceedEstimate: false,
    });
    expect(movingSeconds(estimate, sections, stations)).toBe(5100);
    expect(day.legs).toEqual([
      { fromMeters: 0, toMeters: 2500, ascentMeters: 150, movingSeconds: 425 },
      { fromMeters: 2500, toMeters: 10000, ascentMeters: 450, movingSeconds: 2125 },
      { fromMeters: 10000, toMeters: 15000, ascentMeters: null, movingSeconds: 2550 },
    ]);
  });

  it('counts the stop of a station beyond the course once there is no course to compare with', () => {
    expect(movingSeconds(estimate, [], stations)).toBe(4800);
    expect(movingSeconds(null, sections, stations)).toBeNull();
  });

  it('arrives at a station at the exact course end with the finish, after midnight', () => {
    const day = stationArrivals(estimate, sections, {
      startTime: '23:00',
      finishCutoff: null,
      stations: [station(1, 15000, { cutoff: { dayOffset: 1, time: '01:00' } })],
    });
    expect(day.stations[0]).toMatchObject({
      beyondCourse: false,
      fromStart: { seconds: 6000 },
      timeOfDay: { seconds: 23 * 3600 + 6000, highSeconds: 86400 + 3600 },
      cutoffSeconds: 86400 + 3600,
      cutoffMarginSeconds: 0,
    });
    expect(day.legs.map((leg) => [leg.fromMeters, leg.toMeters])).toEqual([[0, 15000]]);
  });

  it('floors the moving time at zero and says so when stops outlast the estimate', () => {
    const day = stationArrivals(estimate, sections, {
      ...raceDay,
      stations: [station(1, 2500, { stopSeconds: 7000 })],
    });
    expect(day).toMatchObject({ movingSeconds: 0, stopsExceedEstimate: true });
    expect(day.legs.map((leg) => leg.movingSeconds)).toEqual([0, 0]);
  });

  it('arrives at a station on the start line at the start, with no empty leg', () => {
    const day = stationArrivals(estimate, sections, {
      ...raceDay,
      stations: [station(1, 0, { cutoff: { dayOffset: 0, time: '07:10' } })],
    });
    expect(day.stations[0]).toMatchObject({
      fromStart: { seconds: 0, highSeconds: 0 },
      cutoffMarginSeconds: 600,
    });
    expect(day.legs.map((leg) => leg.fromMeters)).toEqual([0]);
  });

  it('keeps cutoffs and distances but no arrival without an estimate', () => {
    const day = stationArrivals(null, sections, raceDay);
    expect(day.stations[0]).toMatchObject({
      fromStart: null,
      timeOfDay: null,
      cutoffSeconds: 8 * 3600,
      cutoffMarginSeconds: null,
    });
    expect(day).toMatchObject({ movingSeconds: null, stopsExceedEstimate: false });
    expect(day.legs[1]).toEqual({
      fromMeters: 2500,
      toMeters: 10000,
      ascentMeters: 450,
      movingSeconds: null,
    });
  });

  it('gives times from the start but no time of day or margin without a start time', () => {
    const day = stationArrivals(estimate, sections, { ...raceDay, startTime: null });
    expect(day.stations[0]).toMatchObject({
      fromStart: { seconds: 500 },
      timeOfDay: null,
      cutoffSeconds: 8 * 3600,
      cutoffMarginSeconds: null,
    });
    expect(day.finish).toMatchObject({ timeOfDay: null, cutoffMarginSeconds: null });
  });

  it('flags nothing beyond the course and has no finish distance without a course', () => {
    const day = stationArrivals(null, [], raceDay);
    expect(day.stations.map((row) => row.beyondCourse)).toEqual([false, false, false]);
    expect(day.finish).toMatchObject({ distanceMeters: null, fromStart: null });
    expect(day.legs).toEqual([
      { fromMeters: 0, toMeters: 2500, ascentMeters: null, movingSeconds: null },
      { fromMeters: 2500, toMeters: 10000, ascentMeters: null, movingSeconds: null },
      { fromMeters: 10000, toMeters: 20000, ascentMeters: null, movingSeconds: null },
    ]);
  });
});

describe('clock time', () => {
  it.each([
    [0, '00:00'],
    [7 * 3600 + 24 * 60 + 29, '07:24'],
    [86400 - 20, '00:00 +1 day'],
    [86400 + 70 * 60, '01:10 +1 day'],
    [2 * 86400 + 15 * 3600, '15:00 +2 days'],
  ])('shows %i seconds after race day midnight as %s', (seconds, label) => {
    expect(clockTime(seconds)).toBe(label);
  });
});

describe('adjusted estimate', () => {
  const planStops = [station(1, 2500), station(2, 10000, { stopSeconds: 600 })];
  const assumption = (
    effortPercent: number,
    weatherPercent: number,
    scenarioStops = planStops,
  ) => ({
    effortPercent,
    weatherPercent,
    stations: scenarioStops,
  });
  const withStop = (id: number, stopSeconds: number) =>
    planStops.map((planned, index) => (index === id - 1 ? { ...planned, stopSeconds } : planned));
  const adjusted = (effort: number, weather: number, scenarioStops = planStops) =>
    adjustedEstimate(estimate, sections, planStops, assumption(effort, weather, scenarioStops))!;

  it('returns the same estimate with no effort, no weather and the plan stops', () => {
    expect(adjustedEstimate(estimate, sections, planStops, assumption(0, 0))).toBe(estimate);
  });

  it('returns the same estimate when the stops outlast it, so the times stay as they were', () => {
    const longStops = [station(1, 2500, { stopSeconds: 7000 })];
    expect(adjustedEstimate(estimate, sections, longStops, assumption(0, 0, longStops))).toBe(
      estimate,
    );
  });

  it('returns nothing without an estimate', () => {
    expect(adjustedEstimate(null, sections, planStops, assumption(8, 6))).toBeNull();
  });

  it('moves the finish by the added stop and leaves the moving time alone', () => {
    const scenarioStops = withStop(1, 300 + 720);
    const result = adjusted(0, 0, scenarioStops);
    expect(result.seconds).toBe(6720);
    expect(movingSeconds(result, sections, scenarioStops)).toBe(
      movingSeconds(estimate, sections, planStops),
    );
  });

  it('delays only the stations after a longer stop', () => {
    const result = adjusted(0, 0, withStop(2, 600 + 1800));
    const before = stationArrivals(estimate, sections, { ...raceDay, stations: planStops });
    const after = stationArrivals(result, sections, { ...raceDay, stations: planStops });
    expect(after.stations[0]!.fromStart!.seconds).toBe(before.stations[0]!.fromStart!.seconds);
    expect(after.finish.fromStart!.seconds).toBe(before.finish.fromStart!.seconds + 1800);
  });

  it('counts a stop exactly on a section boundary in the section after it', () => {
    const boundaryStops = [station(1, 5000)];
    const result = adjustedEstimate(estimate, sections, boundaryStops, {
      ...assumption(0, 0),
      stations: [station(1, 5000, { stopSeconds: 900 })],
    })!;
    expect(result.sectionSeconds).toEqual([1000, 2600, 3000]);
  });

  it('puts a stop at the course end in the last section', () => {
    const endStops = [station(1, 15000)];
    const result = adjustedEstimate(estimate, sections, endStops, {
      ...assumption(0, 0),
      stations: [station(1, 15000, { stopSeconds: 900 })],
    })!;
    expect(result.sectionSeconds).toEqual([1000, 2000, 3600]);
  });

  it('ignores the stop of a station beyond the course', () => {
    const beyondStops = [station(1, 20000)];
    expect(
      adjustedEstimate(estimate, sections, beyondStops, {
        ...assumption(0, 0),
        stations: [station(1, 20000, { stopSeconds: 9000 })],
      }),
    ).toBe(estimate);
  });

  it('composes effort and weather on the moving time only', () => {
    const result = adjusted(8, 6);
    const factor = 1.08 * 1.06;
    expect(result.seconds).toBeCloseTo(6000 + 5100 * (factor - 1), 6);
    expect(movingSeconds(result, sections, planStops)).toBeCloseTo(5100 * factor, 6);
    expect(result.lowSeconds / result.seconds).toBeCloseTo(0.8, 9);
    expect(result.highSeconds / result.seconds).toBeCloseTo(1.2, 9);
    expect(result.sectionSeconds.reduce((sum, value) => sum + value, 0)).toBe(result.seconds);
  });

  it('shrinks the times with a negative effort', () => {
    expect(adjusted(-10, 0).seconds).toBeCloseTo(6000 - 510, 6);
  });

  it('keeps stops out of the effort factor when they outlast the estimate', () => {
    const longStops = [station(1, 2500, { stopSeconds: 7000 })];
    const result = adjustedEstimate(estimate, sections, longStops, {
      ...assumption(20, 0),
      stations: longStops,
    });
    expect(result!.seconds).toBe(6000);
  });

  it('moves the finish cutoff margin past midnight with the adjusted finish', () => {
    const { finish } = stationArrivals(adjusted(20, 0), sections, {
      ...raceDay,
      stations: planStops,
    });
    expect(finish.cutoffMarginSeconds).toBeCloseTo(
      86400 + 1800 - sevenAm - (7200 * 7020) / 6000,
      6,
    );
  });
});
