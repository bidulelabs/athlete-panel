import { describe, expect, it } from 'vitest';
import type { CourseSection, RacePlan } from '@athlete-panel/contracts';
import {
  pacingRows,
  raceDayCommand,
  racePlanCommand,
  startAndCutoffFromForm,
  stationFromForm,
  stationsAfterSave,
  strategyNeedsReview,
} from '../../plugins/race-analysis/race-plan-form';

const raceId = '00000000-0000-4000-8000-000000000001';
const racePlanId = '00000000-0000-4000-8000-000000000010';
const courseId = '00000000-0000-4000-8000-000000000020';
const replacedCourseId = '00000000-0000-4000-8000-000000000021';
const section = (index: number): CourseSection => ({
  index,
  fromMeters: index * 5000,
  toMeters: (index + 1) * 5000,
  ascentMeters: 300,
  descentMeters: 100,
});
const courseSections = [section(0), section(1), section(2)];
const racePlan = (values: Partial<RacePlan> = {}): RacePlan => ({
  id: racePlanId,
  revision: 3,
  eventId: raceId,
  target: 'Finish comfortably',
  briefing: 'Start easy.',
  pacing: [{ fromMeters: 0, toMeters: 5000, effort: 'Easy' }],
  assumptions: ['Dry trail'],
  openQuestions: [],
  startTime: null,
  finishCutoff: null,
  stations: [],
  writtenFor: { courseId, target: 'Finish comfortably' },
  ...values,
});
const existingStation: RacePlan['stations'][number] = {
  id: '00000000-0000-4000-8000-000000000030',
  name: 'Les Pins',
  distanceMeters: 9000,
  cutoff: { dayOffset: 0, time: '09:15' },
  stopSeconds: 240,
  water: true,
  food: 'bananas',
  dropBag: [{ productId: '00000000-0000-4000-8000-000000000040', servings: 2 }],
  action: 'Refill both bottles',
  source: 'race guide',
  verified: true,
};
const unwritten = { briefing: '', pacing: [], assumptions: [], openQuestions: [] };
const filledForm = (fields: Record<string, string>, efforts: string[]) => {
  const form = new FormData();
  for (const [name, text] of Object.entries({
    target: '',
    briefing: '',
    assumptions: '',
    openQuestions: '',
    ...fields,
  }))
    form.set(name, text);
  for (const effort of efforts) form.append('effort', effort);
  return form;
};
const savedForm = (fields: Record<string, string> = {}, efforts = ['Easy', '', '']) =>
  filledForm(
    { target: 'Finish comfortably', briefing: 'Start easy.', assumptions: 'Dry trail', ...fields },
    efforts,
  );

describe('pacing rows', () => {
  it('offers one blank row per course section when nothing is planned', () => {
    expect(pacingRows([], courseSections)).toEqual([
      { fromMeters: 0, toMeters: 5000, effort: '' },
      { fromMeters: 5000, toMeters: 10000, effort: '' },
      { fromMeters: 10000, toMeters: 15000, effort: '' },
    ]);
  });

  it('keeps a planned section and hides the course sections it covers', () => {
    const climb = { fromMeters: 4000, toMeters: 9000, effort: 'Steady climb' };
    expect(pacingRows([climb], courseSections)).toEqual([
      climb,
      { fromMeters: 10000, toMeters: 15000, effort: '' },
    ]);
  });

  it('keeps a section that only touches a planned one', () => {
    const first = { fromMeters: 0, toMeters: 5000, effort: 'Easy' };
    expect(pacingRows([first], courseSections)).toHaveLength(3);
  });

  it('shows the planned sections alone when the race has no course', () => {
    expect(pacingRows(racePlan().pacing, [])).toEqual(racePlan().pacing);
  });
});

describe('strategy needs review', () => {
  it.each([
    ['the course was replaced', racePlan(), replacedCourseId, true],
    ['the course was removed', racePlan(), null, true],
    ['the target changed', racePlan({ target: 'Under 8 hours' }), courseId, true],
    ['nothing changed', racePlan(), courseId, false],
    ['nothing is written yet', racePlan(unwritten), replacedCourseId, false],
    [
      'only an open question is written',
      racePlan({ ...unwritten, openQuestions: ['Poles?'] }),
      replacedCourseId,
      true,
    ],
    [
      'only stations are written and the course was replaced',
      racePlan({ ...unwritten, stations: [existingStation] }),
      replacedCourseId,
      true,
    ],
    [
      'only stations are written and nothing changed',
      racePlan({ ...unwritten, stations: [existingStation] }),
      courseId,
      false,
    ],
  ])('when %s', (_label, plan, activeCourseId, expected) => {
    expect(strategyNeedsReview(plan, activeCourseId)).toBe(expected);
  });
});

describe('race plan command', () => {
  const rows = pacingRows(racePlan().pacing, courseSections);

  it('creates a plan from the target alone', () => {
    const blankRows = pacingRows([], courseSections);
    expect(
      racePlanCommand(
        filledForm({ target: ' Finish comfortably ' }, ['', '', '']),
        blankRows,
        undefined,
        raceId,
        null,
      ),
    ).toEqual({
      action: 'racePlan.create',
      values: { eventId: raceId, target: 'Finish comfortably', ...unwritten, courseId: null },
    });
  });

  it('sends nothing when the form matches the saved plan', () => {
    expect(racePlanCommand(savedForm(), rows, racePlan(), raceId, courseId)).toBeNull();
  });

  it('sends the target alone, without the course, when only the target changed', () => {
    expect(
      racePlanCommand(savedForm({ target: 'Under 8 hours' }), rows, racePlan(), raceId, courseId),
    ).toEqual({
      action: 'racePlan.update',
      id: racePlanId,
      expectedRevision: 3,
      values: { target: 'Under 8 hours' },
    });
  });

  it('sends the changed strategy fields with the course they were written for', () => {
    const command = racePlanCommand(
      savedForm({ openQuestions: ' Poles allowed? \n\n  Drop bag?' }, ['Easy', ' Steady ', '']),
      rows,
      racePlan(),
      raceId,
      replacedCourseId,
    );
    expect(command).toMatchObject({
      action: 'racePlan.update',
      values: {
        pacing: [
          { fromMeters: 0, toMeters: 5000, effort: 'Easy' },
          { fromMeters: 5000, toMeters: 10000, effort: 'Steady' },
        ],
        openQuestions: ['Poles allowed?', 'Drop bag?'],
        courseId: replacedCourseId,
      },
    });
    expect(Object.keys((command as { values: object }).values).sort()).toEqual([
      'courseId',
      'openQuestions',
      'pacing',
    ]);
  });

  it('leaves the start time, finish cutoff and aid stations out of the update', () => {
    const planned = racePlan({
      startTime: '07:00',
      finishCutoff: { dayOffset: 0, time: '15:00' },
      stations: [
        {
          id: '00000000-0000-4000-8000-000000000030',
          name: 'Synthetic col',
          distanceMeters: 9000,
          cutoff: null,
          stopSeconds: 240,
          water: true,
          food: '',
          dropBag: [],
          action: '',
          source: '',
          verified: false,
        },
      ],
    });
    const command = racePlanCommand(
      savedForm({ target: 'Under 8 hours', briefing: 'Go' }),
      rows,
      planned,
      raceId,
      courseId,
    );
    expect(Object.keys((command as { values: object }).values).sort()).toEqual([
      'briefing',
      'courseId',
      'target',
    ]);
  });

  it('removes a planned section whose effort was cleared', () => {
    expect(
      racePlanCommand(savedForm({}, ['', '', '']), rows, racePlan(), raceId, courseId),
    ).toMatchObject({ values: { pacing: [], courseId } });
  });
});

describe('race day command', () => {
  it('updates only the race day fields of a saved plan', () => {
    expect(raceDayCommand({ startTime: '07:00' }, racePlan(), raceId, courseId)).toEqual({
      action: 'racePlan.update',
      id: racePlanId,
      expectedRevision: 3,
      values: { startTime: '07:00' },
    });
  });

  it('creates the plan with the course in use when the race has none', () => {
    expect(raceDayCommand({ stations: [existingStation] }, undefined, raceId, courseId)).toEqual({
      action: 'racePlan.create',
      values: { eventId: raceId, stations: [existingStation], courseId },
    });
  });
});

const stationForm = (fields: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [name, text] of Object.entries({
    name: ' Les Pins ',
    distance: '9',
    cutoffDay: '0',
    cutoffTime: '09:15',
    stopMinutes: '4',
    water: 'on',
    food: ' bananas ',
    action: 'Refill both bottles',
    source: 'race guide',
    verified: 'on',
    ...fields,
  }))
    if (text !== '' || !['water', 'verified'].includes(name)) form.set(name, text);
  return form;
};

describe('station from form', () => {
  it('builds a new station in meters and seconds with a fresh id', () => {
    const station = stationFromForm(stationForm(), undefined, 'metric');
    expect(station).toEqual({ ...existingStation, id: station.id, dropBag: [] });
    expect(station.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the id and the drop bag of the station being edited', () => {
    expect(stationFromForm(stationForm({ name: 'Les Pins' }), existingStation, 'metric')).toEqual(
      existingStation,
    );
  });

  it('reads the distance in miles and keeps an unchanged distance exact', () => {
    const imperial = { ...existingStation, distanceMeters: 9001 };
    expect(
      stationFromForm(stationForm({ distance: '5.593' }), imperial, 'imperial').distanceMeters,
    ).toBe(9001);
    expect(
      stationFromForm(stationForm({ distance: '6' }), imperial, 'imperial').distanceMeters,
    ).toBe(9656);
  });

  it('stores no cutoff when the time is empty, even with a day chosen', () => {
    expect(
      stationFromForm(stationForm({ cutoffDay: '1', cutoffTime: '' }), undefined, 'metric').cutoff,
    ).toBeNull();
  });

  it('stores a next-day cutoff when the time is filled', () => {
    expect(
      stationFromForm(stationForm({ cutoffDay: '1', cutoffTime: '01:30' }), undefined, 'metric')
        .cutoff,
    ).toEqual({ dayOffset: 1, time: '01:30' });
  });

  it('reads unchecked water and confirmation as false', () => {
    expect(
      stationFromForm(stationForm({ water: '', verified: '' }), existingStation, 'metric'),
    ).toMatchObject({ water: false, verified: false });
  });
});

describe('stations after save', () => {
  const later = {
    ...existingStation,
    id: '00000000-0000-4000-8000-000000000031',
    distanceMeters: 19000,
  };

  it('inserts a new station in course order', () => {
    const earlier = {
      ...existingStation,
      id: '00000000-0000-4000-8000-000000000032',
      distanceMeters: 4000,
    };
    expect(
      stationsAfterSave([existingStation, later], earlier).map((station) => station.id),
    ).toEqual([earlier.id, existingStation.id, later.id]);
  });

  it('refuses a second station at the same distance', () => {
    const twin = { ...later, id: '00000000-0000-4000-8000-000000000033' };
    expect(() => stationsAfterSave([existingStation, later], twin)).toThrow(
      'Another aid station is already at this distance.',
    );
  });

  it('replaces an edited station and moves it to its new place', () => {
    const moved = { ...existingStation, distanceMeters: 25000 };
    expect(stationsAfterSave([existingStation, later], moved)).toEqual([later, moved]);
  });
});

describe('start and cutoff from form', () => {
  const startForm = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [name, text] of Object.entries(fields)) form.set(name, text);
    return form;
  };

  it('reads a start time and a next-day finish cutoff', () => {
    expect(
      startAndCutoffFromForm(
        startForm({ startTime: '07:00', finishCutoffDay: '1', finishCutoffTime: '02:00' }),
      ),
    ).toEqual({ startTime: '07:00', finishCutoff: { dayOffset: 1, time: '02:00' } });
  });

  it('clears both when the times are empty, even with a day chosen', () => {
    expect(
      startAndCutoffFromForm(
        startForm({ startTime: '', finishCutoffDay: '2', finishCutoffTime: '' }),
      ),
    ).toEqual({ startTime: null, finishCutoff: null });
  });
});
