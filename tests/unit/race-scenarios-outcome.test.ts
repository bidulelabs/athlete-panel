import { describe, expect, it } from 'vitest';
import {
  emptyRaceNutrition,
  type CourseEstimate,
  type CourseSection,
  type RacePlan,
  type RaceScenario,
} from '@athlete-panel/contracts';
import {
  scenarioOutcome,
  scenarioOutdatedReasons,
  scenarioStations,
} from '../../plugins/race-analysis/scenarios';

type Station = RacePlan['stations'][number];
const section = (index: number): CourseSection => ({
  index,
  fromMeters: index * 5000,
  toMeters: (index + 1) * 5000,
  ascentMeters: 300,
  descentMeters: 0,
});
const sections = [section(0), section(1), section(2)];
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
const firstStation = station(1, 2500, { cutoff: { dayOffset: 0, time: '08:00' } });
const secondStation = station(2, 10000, { stopSeconds: 600 });
const stationBeyondCourse = station(3, 20000);
const plan = {
  startTime: '07:00',
  finishCutoff: { dayOffset: 1, time: '00:30' },
  stations: [firstStation, secondStation, stationBeyondCourse],
  nutrition: emptyRaceNutrition,
  effortPercent: 0,
  weatherPercent: 0,
} as RacePlan;
const carryInputs = { products: [], carryCapacityMillilitres: null };
const scenarioWith = (values: Partial<RaceScenario> = {}) =>
  ({
    effortPercent: 0,
    weatherPercent: 0,
    stops: [],
    basedOn: {
      courseId: 'course',
      stations: plan.stations.map(({ id, distanceMeters, stopSeconds, cutoff }) => ({
        id,
        distanceMeters,
        stopSeconds,
        cutoff,
      })),
      courseEstimate: { seconds: 6000, lowSeconds: 4800, highSeconds: 7200 },
      effortPercent: 0,
      weatherPercent: 0,
    },
    ...values,
  }) as RaceScenario;
const outcomeOf = (scenario: RaceScenario | null, withEstimate: CourseEstimate | null = estimate) =>
  scenarioOutcome(withEstimate, sections, plan, scenario, carryInputs);
const planOutcome = outcomeOf(null);

describe('scenario outcome', () => {
  it('gives the plan outcome for the plan stops and no effort', () => {
    const samePlanStops = scenarioWith({
      stops: plan.stations.map((planned) => ({
        stationId: planned.id,
        stopSeconds: planned.stopSeconds,
      })),
    });
    expect(outcomeOf(samePlanStops)).toEqual(planOutcome);
  });

  it('moves the finish by a longer stop and keeps the moving time', () => {
    const longer = outcomeOf(
      scenarioWith({ stops: [{ stationId: firstStation.id, stopSeconds: 300 + 720 }] }),
    );
    expect(longer.finish.fromStart!.seconds).toBe(planOutcome.finish.fromStart!.seconds + 720);
    expect(longer.movingSeconds).toBe(planOutcome.movingSeconds);
    expect(longer.stopSeconds).toBe(planOutcome.stopSeconds + 720);
  });

  it('does not move an earlier station when a later stop is longer', () => {
    const longerLastStop = outcomeOf(
      scenarioWith({ stops: [{ stationId: secondStation.id, stopSeconds: 600 + 1800 }] }),
    );
    expect(longerLastStop.cutoffs).toEqual(planOutcome.cutoffs);
    expect(longerLastStop.finish.fromStart!.seconds).toBe(
      planOutcome.finish.fromStart!.seconds + 1800,
    );
  });

  it('composes effort and weather on the moving time', () => {
    const hot = outcomeOf(scenarioWith({ effortPercent: 8, weatherPercent: 6 }));
    expect(hot.movingSeconds).toBeCloseTo(6000 * 1.08 * 1.06);
    expect(hot.finish.fromStart!.seconds).toBeCloseTo(900 + 6000 * 1.08 * 1.06);
  });

  it('keeps stops and cutoffs without an estimate', () => {
    const withoutEstimate = outcomeOf(
      scenarioWith({ stops: [{ stationId: firstStation.id, stopSeconds: 900 }] }),
      null,
    );
    expect(withoutEstimate.finish.fromStart).toBeNull();
    expect(withoutEstimate.carry).toBeNull();
    expect(withoutEstimate.stopSeconds).toBe(900 + 600);
    expect(withoutEstimate.cutoffs).toEqual([
      { name: firstStation.name, cutoffMarginSeconds: null },
    ]);
  });

  it('ignores the stop of a station beyond the course', () => {
    const longerStopBeyondCourse = outcomeOf(
      scenarioWith({ stops: [{ stationId: stationBeyondCourse.id, stopSeconds: 3600 }] }),
    );
    expect(longerStopBeyondCourse.finish).toEqual(planOutcome.finish);
    expect(longerStopBeyondCourse.stopSeconds).toBe(planOutcome.stopSeconds);
  });

  it('measures the finish margin against a cutoff the next day', () => {
    const latestFinishSeconds = 7 * 3600 + 7200 + 900;
    expect(planOutcome.finish.cutoffMarginSeconds).toBe(86400 + 1800 - latestFinishSeconds);
  });
});

describe('scenario stations', () => {
  it('keeps the plan stop of a station the scenario does not list, and ignores a removed one', () => {
    const removedId = '00000000-0000-4000-8000-000000000099';
    const stationsOfScenario = scenarioStations(
      plan.stations,
      scenarioWith({
        stops: [
          { stationId: firstStation.id, stopSeconds: 60 },
          { stationId: removedId, stopSeconds: 60 },
        ],
      }),
    );
    expect(stationsOfScenario.map(({ id, stopSeconds }) => [id, stopSeconds])).toEqual([
      [firstStation.id, 60],
      [secondStation.id, 600],
      [stationBeyondCourse.id, 300],
    ]);
  });
});

describe('scenario outdated reasons', () => {
  const reasons = (
    stations: Station[],
    courseId: string | null = 'course',
    planValues: Partial<RacePlan> = {},
    scenario = scenarioWith(),
    courseEstimate: CourseEstimate | null = estimate,
  ) =>
    scenarioOutdatedReasons(
      { ...plan, stations, ...planValues } as RacePlan,
      courseId,
      courseEstimate,
      scenario,
      'metric',
    );

  it.each([
    ['its central time', { ...estimate, seconds: 6300 }],
    ['only its low end', { ...estimate, lowSeconds: 5000 }],
    ['only its high end', { ...estimate, highSeconds: 6900 }],
    ['to none', null],
  ])('says once that the course estimate changed, with %s changed', (_label, now) => {
    expect(reasons(plan.stations, 'course', {}, scenarioWith(), now)).toEqual([
      'The course estimate changed.',
    ]);
  });

  it('gives the effort as the only reason when only the plan effort changed', () => {
    expect(reasons(plan.stations, 'course', { effortPercent: 5 })).toEqual([
      "The plan's effort changed.",
    ]);
  });

  it('names a station cutoff changed or removed since the scenario was saved', () => {
    expect(
      reasons([
        { ...firstStation, cutoff: { dayOffset: 0, time: '08:15' } },
        { ...secondStation, cutoff: { dayOffset: 0, time: '09:00' } },
        stationBeyondCourse,
      ]),
    ).toEqual([
      'The cutoff at Synthetic station 1 changed.',
      'The cutoff at Synthetic station 2 changed.',
    ]);
    expect(
      reasons([{ ...firstStation, cutoff: null }, secondStation, stationBeyondCourse]),
    ).toEqual(['The cutoff at Synthetic station 1 changed.']);
  });

  it('names both the stop and the cutoff of one station', () => {
    expect(
      reasons([
        firstStation,
        { ...secondStation, stopSeconds: 900, cutoff: { dayOffset: 0, time: '09:00' } },
        stationBeyondCourse,
      ]),
    ).toEqual([
      'The stop at Synthetic station 2 changed.',
      'The cutoff at Synthetic station 2 changed.',
    ]);
  });

  it('names a plan stop changed since the scenario was saved', () => {
    expect(
      reasons([firstStation, { ...secondStation, stopSeconds: 900 }, stationBeyondCourse]),
    ).toEqual(['The stop at Synthetic station 2 changed.']);
  });

  it('says the plan effort or weather changed since the scenario was saved', () => {
    expect(reasons(plan.stations, 'course', { effortPercent: 5 })).toEqual([
      "The plan's effort changed.",
    ]);
    expect(reasons(plan.stations, 'course', { weatherPercent: -2.5 })).toEqual([
      "The plan's weather changed.",
    ]);
  });

  it('compares only the course and stations of a scenario saved without estimate, stops, cutoffs, effort or weather', () => {
    const savedBefore = scenarioWith({
      basedOn: {
        courseId: 'course',
        stations: plan.stations.map(({ id, distanceMeters }) => ({ id, distanceMeters })),
      },
    });
    expect(
      reasons(
        [
          { ...firstStation, cutoff: null },
          { ...secondStation, stopSeconds: 900 },
          stationBeyondCourse,
        ],
        'course',
        { effortPercent: 5, weatherPercent: 5 },
        savedBefore,
        { ...estimate, seconds: 6300 },
      ),
    ).toEqual([]);
  });

  it('is empty when the course and the stations are those it was made from', () => {
    expect(reasons(plan.stations)).toEqual([]);
  });

  it('names a station added to the plan', () => {
    expect(reasons([...plan.stations, station(4, 12000)])).toEqual([
      'Synthetic station 4 was added.',
    ]);
  });

  it('names a station moved in the plan', () => {
    expect(
      reasons([firstStation, { ...secondStation, distanceMeters: 11000 }, stationBeyondCourse]),
    ).toEqual(['Synthetic station 2 was moved.']);
  });

  it('names a removed station by its distance', () => {
    expect(reasons([firstStation, stationBeyondCourse])).toEqual([
      'The station at 10.0 km was removed.',
    ]);
  });

  it('lists two stations added with the same name', () => {
    expect(
      reasons([
        ...plan.stations,
        station(4, 12000, { name: 'Les Pins' }),
        station(5, 14000, { name: 'Les Pins' }),
      ]),
    ).toEqual(['Les Pins was added.', 'Les Pins was added.']);
  });

  it('lists every reason at once', () => {
    expect(
      reasons(
        [{ ...firstStation, distanceMeters: 3000 }, stationBeyondCourse, station(4, 12000)],
        'other-course',
      ),
    ).toEqual([
      'The course changed.',
      'The station at 10.0 km was removed.',
      'Synthetic station 1 was moved.',
      'Synthetic station 4 was added.',
    ]);
  });

  it('says the course changed', () => {
    expect(
      reasons(plan.stations, 'other-course', {}, scenarioWith(), { ...estimate, seconds: 6300 }),
    ).toEqual(['The course changed.']);
  });
});
