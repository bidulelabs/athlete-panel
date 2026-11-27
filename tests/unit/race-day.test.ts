import { describe, expect, it } from 'vitest';
import type { CourseEstimate, CourseSection, RacePlan } from '@athlete-panel/contracts';
import { adjustedEstimate, stationArrivals } from '../../plugins/race-analysis/race-day';
import { clockTime } from '../../plugins/race-analysis/presentation';
import { estimateCourse } from '../../plugins/race-analysis/estimate';
import { analyzeTrack } from '../../plugins/race-analysis/geometry';
import { parseTrack } from '../../plugins/race-analysis/parse';
import { syntheticGpx } from '../fixtures/race-analysis';

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
      fromStart: { seconds: 3300, lowSeconds: 2700, highSeconds: 3900 },
      cutoffSeconds: null,
      cutoffMarginSeconds: null,
    });
  });

  it('counts a finish cutoff on the next day from race-day midnight', () => {
    const { finish } = stationArrivals(estimate, sections, raceDay);
    expect(finish).toMatchObject({
      distanceMeters: 15000,
      fromStart: { seconds: 6900, highSeconds: 8100 },
      cutoffSeconds: 86400 + 1800,
      cutoffMarginSeconds: 86400 + 1800 - sevenAm - 8100,
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

  it('adds only the stops of stations on the course to the moving time, per leg and in total', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day).toMatchObject({ plannedStopSeconds: 900, movingSeconds: 6000 });
    expect(day.legs).toEqual([
      { fromMeters: 0, toMeters: 2500, ascentMeters: 150, movingSeconds: 500 },
      { fromMeters: 2500, toMeters: 10000, ascentMeters: 450, movingSeconds: 2500 },
      { fromMeters: 10000, toMeters: 15000, ascentMeters: null, movingSeconds: 3000 },
    ]);
  });

  it('delays a station by the stops before it, never by a later one', () => {
    const plan = [
      station(1, 6000, { cutoff: { dayOffset: 0, time: '08:10' } }),
      station(2, 9000, { stopSeconds: 300 }),
    ];
    const longerStop = [plan[0]!, { ...plan[1]!, stopSeconds: 300 + 1800 }];
    const before = stationArrivals(estimate, sections, { ...raceDay, stations: plan });
    const after = stationArrivals(estimate, sections, { ...raceDay, stations: longerStop });
    expect(after.stations[0]).toEqual({ ...before.stations[0], station: longerStop[0] });
    expect(after.stations[0]!.cutoffMarginSeconds).toBeGreaterThan(0);
    expect(after.finish.fromStart!.seconds).toBe(before.finish.fromStart!.seconds + 1800);
  });

  it('moves the finish of a plan by the change of one of its stops', () => {
    const before = stationArrivals(estimate, sections, raceDay);
    const after = stationArrivals(estimate, sections, {
      ...raceDay,
      stations: [stations[0]!, { ...stations[1]!, stopSeconds: 600 + 720 }, stations[2]!],
    });
    expect(after.finish.fromStart!.seconds - before.finish.fromStart!.seconds).toBe(720);
    expect(after.finish.fromStart!.highSeconds - before.finish.fromStart!.highSeconds).toBe(720);
    expect(after.movingSeconds).toBe(before.movingSeconds);
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

  it('adds stops longer than the whole estimate to the finish', () => {
    const day = stationArrivals(estimate, sections, {
      ...raceDay,
      stations: [station(1, 2500, { stopSeconds: 7000 })],
    });
    expect(day).toMatchObject({ movingSeconds: 6000, finish: { fromStart: { seconds: 13000 } } });
    expect(day.legs.map((leg) => leg.movingSeconds)).toEqual([500, 5500]);
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
    expect(day).toMatchObject({ movingSeconds: null, plannedStopSeconds: 900 });
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

describe('pauses in the reference efforts', () => {
  const analyze = (options: Parameters<typeof syntheticGpx>[0]) =>
    analyzeTrack(
      parseTrack({ name: 'effort.gpx', bytes: Buffer.from(syntheticGpx(options)) }, 'reference'),
    );
  it('finishes after 80 min, not 110, with three 50 min efforts paused 30 min and a 30 min stop', () => {
    const shape = { km: 8, ascent: 400 };
    const references = ['a', 'b', 'c'].map((salt, index) => {
      const effort = analyze({ ...shape, seconds: 3000, pauseSeconds: 1800, salt });
      return {
        id: `00000000-0000-4000-8000-00000000010${index}`,
        assetId: `00000000-0000-4000-8000-00000000020${index}`,
        title: `Paused ${salt}`,
        filename: `${salt}.gpx`,
        distanceMeters: effort.distanceMeters,
        ascentMeters: effort.ascentMeters,
        durationSeconds: effort.movingSeconds!,
        durationSource: 'file' as const,
        terrain: 3,
        hasGaps: effort.hasGaps,
      };
    });
    const course = analyze(shape);
    const day = stationArrivals(
      estimateCourse(course, 3, {}, references).estimate,
      course.sections,
      {
        startTime: '07:00',
        finishCutoff: null,
        stations: [station(1, 4000, { stopSeconds: 1800 })],
      },
    );
    expect(Math.round(day.finish.fromStart!.seconds)).toBe(4800);
    expect(clockTime(day.finish.timeOfDay!.seconds)).toBe('08:20');
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
  const adjusted = (effortPercent: number, weatherPercent: number) =>
    adjustedEstimate(estimate, { effortPercent, weatherPercent })!;

  it('returns the same estimate with no effort and no weather, so the times stay as they were', () => {
    expect(adjusted(0, 0)).toBe(estimate);
    const { finish } = stationArrivals(adjusted(0, 0), sections, {
      ...raceDay,
      stations: planStops,
    });
    expect(finish.fromStart).toEqual({ seconds: 6900, lowSeconds: 5700, highSeconds: 8100 });
  });

  it('returns nothing without an estimate', () => {
    expect(adjustedEstimate(null, { effortPercent: 8, weatherPercent: 6 })).toBeNull();
  });

  it('composes effort and weather on the moving time only', () => {
    const factor = 1.08 * 1.06;
    const result = adjusted(8, 6);
    expect(result.seconds).toBeCloseTo(6000 * factor, 6);
    expect(result.lowSeconds / result.seconds).toBeCloseTo(0.8, 9);
    expect(result.highSeconds / result.seconds).toBeCloseTo(1.2, 9);
    expect(result.sectionSeconds.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      result.seconds,
      6,
    );
    const day = stationArrivals(result, sections, { ...raceDay, stations: planStops });
    expect(day.plannedStopSeconds).toBe(900);
    expect(day.finish.fromStart!.seconds).toBeCloseTo(6000 * factor + 900, 6);
  });

  it('shrinks the moving time with a negative effort', () => {
    expect(adjusted(-10, 0).seconds).toBeCloseTo(5400, 6);
  });

  it('moves the finish cutoff margin past midnight with the adjusted finish', () => {
    const { finish } = stationArrivals(adjusted(20, 0), sections, {
      ...raceDay,
      stations: planStops,
    });
    expect(finish.cutoffMarginSeconds).toBeCloseTo(86400 + 1800 - sevenAm - 7200 * 1.2 - 900, 6);
  });
});
