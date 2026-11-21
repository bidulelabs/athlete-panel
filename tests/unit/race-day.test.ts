import { describe, expect, it } from 'vitest';
import type { CourseEstimate, CourseSection, RacePlan } from '@athlete-panel/contracts';
import { stationArrivals } from '../../plugins/race-analysis/race-day';

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
      elapsed: { aimSeconds: 500, lowSeconds: 400, highSeconds: 600 },
      timeOfDay: { aimSeconds: sevenAm + 500, highSeconds: sevenAm + 600 },
      cutoffSeconds: 8 * 3600,
      cutoffMarginSeconds: 8 * 3600 - sevenAm - 600,
    });
    expect(day.stations[1]).toMatchObject({
      elapsed: { aimSeconds: 3000 },
      cutoffSeconds: null,
      cutoffMarginSeconds: null,
    });
  });

  it('counts a finish cutoff on the next day from race-day midnight', () => {
    const { finish } = stationArrivals(estimate, sections, raceDay);
    expect(finish).toMatchObject({
      distanceMeters: 15000,
      elapsed: { aimSeconds: 6000, highSeconds: 7200 },
      cutoffSeconds: 86400 + 1800,
      cutoffMarginSeconds: 86400 + 1800 - sevenAm - 7200,
    });
  });

  it('flags a station beyond the course without an arrival, and keeps the others', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day.stations.map((row) => row.beyondCourse)).toEqual([false, false, true]);
    expect(day.stations[2]).toMatchObject({
      elapsed: null,
      timeOfDay: null,
      cutoffMarginSeconds: null,
    });
  });

  it('subtracts planned stops from the estimate for the moving time, per leg and in total', () => {
    const day = stationArrivals(estimate, sections, raceDay);
    expect(day).toMatchObject({
      plannedStopSeconds: 1200,
      movingSeconds: 4800,
      stopsExceedEstimate: false,
    });
    expect(day.legs).toEqual([
      { fromMeters: 0, toMeters: 2500, ascentMeters: 150, movingSeconds: 400 },
      { fromMeters: 2500, toMeters: 10000, ascentMeters: 450, movingSeconds: 2000 },
      { fromMeters: 10000, toMeters: 15000, ascentMeters: null, movingSeconds: 2400 },
    ]);
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
      elapsed: { aimSeconds: 0, highSeconds: 0 },
      cutoffMarginSeconds: 600,
    });
    expect(day.legs.map((leg) => leg.fromMeters)).toEqual([0]);
  });

  it('keeps cutoffs and distances but no arrival without an estimate', () => {
    const day = stationArrivals(null, sections, raceDay);
    expect(day.stations[0]).toMatchObject({
      elapsed: null,
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

  it('gives times from the start but no timeOfDay or margin without a start time', () => {
    const day = stationArrivals(estimate, sections, { ...raceDay, startTime: null });
    expect(day.stations[0]).toMatchObject({
      elapsed: { aimSeconds: 500 },
      timeOfDay: null,
      cutoffSeconds: 8 * 3600,
      cutoffMarginSeconds: null,
    });
    expect(day.finish).toMatchObject({ timeOfDay: null, cutoffMarginSeconds: null });
  });

  it('flags nothing beyond the course and has no finish distance without a course', () => {
    const day = stationArrivals(null, [], raceDay);
    expect(day.stations.map((row) => row.beyondCourse)).toEqual([false, false, false]);
    expect(day.finish).toMatchObject({ distanceMeters: null, elapsed: null });
    expect(day.legs).toEqual([
      { fromMeters: 0, toMeters: 2500, ascentMeters: null, movingSeconds: null },
      { fromMeters: 2500, toMeters: 10000, ascentMeters: null, movingSeconds: null },
      { fromMeters: 10000, toMeters: 20000, ascentMeters: null, movingSeconds: null },
    ]);
  });
});
