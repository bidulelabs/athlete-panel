import { describe, expect, it } from 'vitest';
import {
  emptyRaceNutrition,
  type CourseEstimate,
  type RacePlan,
  type RaceScenario,
} from '@athlete-panel/contracts';
import {
  changedScenarioValues,
  createScenarioCommand,
  duplicateScenarioCommand,
  stopMinutesText,
} from '../../plugins/race-analysis/scenario-form';

type Station = RacePlan['stations'][number];
const station = (number: number, distanceMeters: number, stopSeconds: number): Station => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name: `Synthetic station ${number}`,
  distanceMeters,
  cutoff: null,
  stopSeconds,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: false,
});
const firstStation = station(1, 5000, 300);
const secondStation = station(2, 10000, 100);
const addedStation = station(3, 15000, 420);
const planWith = (stations: Station[]) =>
  ({
    eventId: '00000000-0000-4000-8000-0000000000aa',
    stations,
    nutrition: emptyRaceNutrition,
    effortPercent: 0,
    weatherPercent: 0,
  }) as RacePlan;
const plan = planWith([firstStation, secondStation]);
const basedOnPlan = (stations: Station[]) => ({
  courseId: 'course',
  stations: stations.map(({ id, distanceMeters, stopSeconds, cutoff }) => ({
    id,
    distanceMeters,
    stopSeconds,
    cutoff,
  })),
  courseEstimate: { seconds: 6000, lowSeconds: 4800, highSeconds: 7200 },
  effortPercent: 0,
  weatherPercent: 0,
});
const scenario = {
  id: '00000000-0000-4000-8000-0000000000bb',
  eventId: plan.eventId,
  revision: 3,
  name: 'Hot and careful',
  effortPercent: 8,
  weatherPercent: 6,
  weatherNote: 'Hot valley',
  stops: [
    { stationId: firstStation.id, stopSeconds: 600 },
    { stationId: secondStation.id, stopSeconds: 100 },
  ],
  basedOn: basedOnPlan(plan.stations),
} as RaceScenario;
const formOf = (
  values: {
    name?: string;
    effort?: string;
    weather?: string;
    note?: string;
    stops?: string[];
  } = {},
) => {
  const form = new FormData();
  form.set('name', values.name ?? scenario.name);
  form.set('effortPercent', values.effort ?? '8');
  form.set('weatherPercent', values.weather ?? '6');
  form.set('weatherNote', values.note ?? scenario.weatherNote);
  for (const minutes of values.stops ?? ['10', stopMinutesText(100)])
    form.append('stopMinutes', minutes);
  return form;
};
const opened = { scenario, plan, outdated: false };
const courseEstimate = {
  seconds: 6000,
  lowSeconds: 4800,
  highSeconds: 7200,
  referenceCount: 3,
} as CourseEstimate;
const current = { scenario, plan, courseId: 'course', courseEstimate };

describe('changed scenario values', () => {
  it('sends nothing when nothing changed, even for a stop that is not a whole minute', () => {
    expect(changedScenarioValues(formOf(), opened, current)).toEqual({});
  });

  it('sends only the field that changed', () => {
    expect(changedScenarioValues(formOf({ effort: '5.5' }), opened, current)).toEqual({
      effortPercent: 5.5,
    });
    expect(changedScenarioValues(formOf({ name: '  Calm  ' }), opened, current)).toEqual({
      name: 'Calm',
    });
  });

  it('rewrites the stops and basedOn from the current plan when a stop changed', () => {
    const changed = changedScenarioValues(formOf({ stops: ['10', '4'] }), opened, current);
    expect(changed).toEqual({
      stops: [
        { stationId: firstStation.id, stopSeconds: 600 },
        { stationId: secondStation.id, stopSeconds: 240 },
      ],
      basedOn: basedOnPlan(plan.stations),
    });
  });

  it('leaves basedOn and stops alone when only other fields changed', () => {
    const changed = changedScenarioValues(formOf({ effort: '0', weather: '0' }), opened, current);
    expect(changed).toEqual({ effortPercent: 0, weatherPercent: 0 });
  });

  it('takes a station added to the plan after opening with the plan stop', () => {
    const planWithAddedStation = planWith([firstStation, secondStation, addedStation]);
    const changed = changedScenarioValues(formOf({ stops: ['10', '4'] }), opened, {
      ...current,
      plan: planWithAddedStation,
    });
    expect(changed.stops).toEqual([
      { stationId: firstStation.id, stopSeconds: 600 },
      { stationId: secondStation.id, stopSeconds: 240 },
      { stationId: addedStation.id, stopSeconds: 420 },
    ]);
    expect(changed.basedOn).toEqual(basedOnPlan(planWithAddedStation.stations));
  });

  it('drops a station removed from the plan after opening', () => {
    const changed = changedScenarioValues(formOf({ stops: ['10', '4'] }), opened, {
      ...current,
      plan: planWith([secondStation]),
    });
    expect(changed.stops).toEqual([{ stationId: secondStation.id, stopSeconds: 240 }]);
  });

  it('keeps the stop of an untouched row that changed elsewhere', () => {
    const savedElsewhere = {
      ...scenario,
      stops: [
        { stationId: firstStation.id, stopSeconds: 900 },
        { stationId: secondStation.id, stopSeconds: 100 },
      ],
    };
    const changed = changedScenarioValues(formOf({ stops: ['10', '4'] }), opened, {
      ...current,
      scenario: savedElsewhere,
    });
    expect(changed.stops).toEqual([
      { stationId: firstStation.id, stopSeconds: 900 },
      { stationId: secondStation.id, stopSeconds: 240 },
    ]);
  });

  it('rewrites stops and basedOn for an outdated scenario saved with no other change', () => {
    const planWithAddedStation = planWith([firstStation, secondStation, addedStation]);
    const changed = changedScenarioValues(
      formOf(),
      { ...opened, outdated: true },
      { ...current, plan: planWithAddedStation },
    );
    expect(Object.keys(changed).sort()).toEqual(['basedOn', 'stops']);
    expect(changed.basedOn).toEqual(basedOnPlan(planWithAddedStation.stations));
  });
});

describe('scenario commands', () => {
  it('creates from the plan stations and the current course', () => {
    const command = createScenarioCommand(formOf({ name: 'New' }), plan, 'course', courseEstimate);
    expect(command).toMatchObject({
      action: 'raceScenario.create',
      values: {
        eventId: plan.eventId,
        name: 'New',
        stops: [
          { stationId: firstStation.id, stopSeconds: 600 },
          { stationId: secondStation.id, stopSeconds: 100 },
        ],
        basedOn: basedOnPlan(plan.stations),
      },
    });
  });

  it('records the course estimate, or none, and the cutoff of each station', () => {
    const cutoff = { dayOffset: 0, time: '09:00' };
    const command = createScenarioCommand(
      formOf(),
      planWith([{ ...firstStation, cutoff }, secondStation]),
      'course',
      null,
    );
    const { basedOn } = (command as { values: Pick<RaceScenario, 'basedOn'> }).values;
    expect(basedOn.courseEstimate).toBeNull();
    expect(basedOn.stations.map((station) => station.cutoff)).toEqual([cutoff, null]);
  });

  it('duplicates as a copy that keeps stops and basedOn', () => {
    const command = duplicateScenarioCommand(scenario);
    expect(command).toMatchObject({
      action: 'raceScenario.create',
      values: { name: 'Hot and careful (copy)', stops: scenario.stops, basedOn: scenario.basedOn },
    });
  });

  it('keeps the name of a copy within 80 characters', () => {
    const command = duplicateScenarioCommand({ ...scenario, name: 'x'.repeat(80) });
    const copyName = (command as { values: { name: string } }).values.name;
    expect(copyName).toHaveLength(80);
    expect(copyName.endsWith(' (copy)')).toBe(true);
  });

  it.each([
    ['an emoji with a skin tone', '\u{1F44D}\u{1F3FD}'],
    ['a family emoji joined by ZWJ', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'],
  ])('leaves out %s that the copy name cannot hold whole', (_label, emoji) => {
    const command = duplicateScenarioCommand({ ...scenario, name: `${'x'.repeat(72)}${emoji}` });
    expect((command as { values: { name: string } }).values.name).toBe(`${'x'.repeat(72)} (copy)`);
  });
});
