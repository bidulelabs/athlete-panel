import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  canLinkSport,
  classifyGarminSport,
  emptyWorkspace,
  garminSportTypes,
  sportGroup,
  sportSelectionLabel,
  workoutSchema,
  type CommandInput,
} from '@athlete-panel/contracts';
import { applyCommands, validateWorkspace } from '../../plugins/training/engine';
import { weeklySummary } from '../../plugins/training/summary';
import { normalizeActivities } from '../../plugins/garmin/normalize';
import {
  boundedContext,
  assertReadableSources,
} from '../../plugins/agent-bridge/proposal-validation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = '2026-10-25';
const base = {
  id: id(1),
  title: 'Mountain session',
  sport: 'other',
  sportSubgroup: 'mountaineering',
  schedule: { kind: 'independent' as const, date: day },
};
const create = (values = {}) =>
  applyCommands(emptyWorkspace(), [{ action: 'workout.create', values: { ...base, ...values } }], {
    actor: 'owner',
  }).state;
const recorded = (values = {}) =>
  activitySchema.parse({
    id: id(2),
    revision: 1,
    provider: 'garmin',
    externalId: '555:999',
    title: 'Hiking is only a title',
    ...classifyGarminSport({ typeId: '37', typeKey: 'mountaineering', parentTypeId: '4' }),
    startedAt: `${day}T00:30:00Z`,
    localDate: day,
    dateSource: 'provider',
    durationSeconds: 4500,
    distanceMeters: 7000,
    elevationMeters: 900,
    averageHeartRateBpm: null,
    ...values,
  });

describe('Garmin classification and migration-ready planning', () => {
  it('resolves every pinned identity without collapsing hiking and mountaineering', () => {
    for (const type of garminSportTypes.filter((type) => type.typeId !== '17')) {
      const result = classifyGarminSport(type);
      expect(result.sportResolution, type.typeKey).toBe('resolved');
      expect(result.sport).toBe(sportGroup(type.typeKey)?.typeKey);
      expect(result.sportSubgroup).toBe(type.parentTypeId === '17' ? null : type.typeKey);
    }
    expect(
      classifyGarminSport({ typeKey: 'hiking', typeId: '3', parentTypeId: '17' }),
    ).toMatchObject({ sport: 'hiking', sportSubgroup: null });
    expect(sportSelectionLabel(recorded())).toBe('Other · Mountaineering');
    expect(canLinkSport({ sport: 'hiking' }, recorded())).toBe(false);
    expect(canLinkSport({ sport: 'other' }, recorded())).toBe(true);
    expect(canLinkSport(base, recorded())).toBe(true);
    expect(canLinkSport({ sport: 'other', sportSubgroup: 'rock_climbing' }, recorded())).toBe(
      false,
    );
    expect(
      canLinkSport(
        { sport: 'other' },
        recorded({ sport: 'other', sportSubgroup: null, sportResolution: undefined }),
      ),
    ).toBe(false);
  });

  it('retains unknown keys and conflicting provider references without guessing parents', () => {
    for (const source of [
      { typeKey: 'new_mountain_sport', typeId: '999', parentTypeId: '4' },
      { typeKey: 'mountaineering', typeId: '37', parentTypeId: '3' },
    ]) {
      const classified = classifyGarminSport(source);
      expect(classified).toMatchObject({ sport: source.typeKey, sportResolution: 'unresolved' });
      expect(canLinkSport(base, classified)).toBe(false);
    }
  });

  it('maps list metrics including zero, missing and IF above one without extra inference', () => {
    const rows = normalizeActivities(
      [
        {
          activityId: '999',
          ownerId: '555',
          activityName: 'Run title',
          activityType: { typeKey: 'mountaineering', typeId: 37, parentTypeId: 4 },
          startTimeGMT: '2026-10-24 23:30:00',
          startTimeLocal: '2026-10-25 01:30:00',
          trainingStressScore: 0,
          intensityFactor: 1.2,
          normPower: 0,
        },
      ],
      'Europe/Paris',
    );
    expect(rows[0]).toMatchObject({
      sport: 'other',
      sportSubgroup: 'mountaineering',
      garminActivityType: { typeId: '37', typeKey: 'mountaineering', parentTypeId: '4' },
      localDate: day,
      trainingStressScore: 0,
      intensityFactor: 1.2,
      normalizedPowerWatts: 0,
    });
  });

  it('preserves partial status and annotations across repeated links and omitted updates', () => {
    let state = create();
    state.activities.push(recorded());
    const run = (commands: CommandInput[]) =>
      (state = applyCommands(state, commands, { actor: 'owner' }).state);
    run([
      {
        action: 'workout.complete',
        id: id(1),
        expectedRevision: 1,
        values: {
          status: 'partial',
          performedDate: day,
          reason: 'Stopped early',
          notes: 'Line one\nLine two',
          rpe: 7,
        },
      },
    ]);
    run([{ action: 'workout.link', id: id(1), expectedRevision: 2, activityId: id(2) }]);
    const completion = state.workouts[0]!.completion;
    expect(completion).toMatchObject({
      status: 'partial',
      reason: 'Stopped early',
      notes: 'Line one\nLine two',
      rpe: 7,
      durationSeconds: 4500,
    });
    run([
      {
        action: 'workout.link',
        id: id(1),
        expectedRevision: state.workouts[0]!.revision,
        activityId: id(2),
      },
    ]);
    expect(state.workouts[0]!.completion).toEqual(completion);
    run([
      {
        action: 'workout.complete',
        id: id(1),
        expectedRevision: state.workouts[0]!.revision,
        values: { status: 'completed', performedDate: day },
      },
    ]);
    expect(state.workouts[0]!.completion).toMatchObject({
      reason: 'Stopped early',
      notes: 'Line one\nLine two',
      rpe: 7,
    });
    expect(() =>
      validateWorkspace({
        ...state,
        activities: [recorded({ sport: 'hiking', sportSubgroup: null })],
      }),
    ).toThrow(/sports/);
  });

  it('excludes rest days from totals and rejects their prescriptions and completion', () => {
    const rest = { kind: 'rest', sport: null, sportSubgroup: null };
    const state = create(rest);
    expect(weeklySummary(state, '2026-10-19')).toMatchObject({
      planned: { sessions: 0 },
      sportBreakdown: [],
      plannedStatus: { pending: 0 },
    });
    for (const extra of [
      { durationSeconds: 0 },
      { plannedElevationGainMeters: 0 },
      { exercises: [{ name: 'Squat' }] },
    ]) {
      expect(() => create({ ...rest, ...extra })).toThrow(/Rest/);
    }
    expect(() =>
      applyCommands(
        state,
        [
          {
            action: 'workout.complete',
            id: id(1),
            expectedRevision: 1,
            values: { status: 'completed', performedDate: day },
          },
        ],
        { actor: 'owner' },
      ),
    ).toThrow(/Rest/);
  });

  it('keeps zero elevation, prescriptions, long text and older snapshots readable', () => {
    const narrative = 'a\n'.repeat(10000);
    const state = create({
      plannedElevationGainMeters: 0,
      notes: narrative,
      exercises: [
        {
          name: 'Squat',
          sets: 3,
          repetitions: '8–10',
          weightKg: 20,
          loadDescription: 'per hand',
          instructions: 'Private instruction',
        },
        { name: 'Plank', repetitions: '30 sec', loadDescription: 'Bodyweight' },
        { name: 'Pull-up', repetitions: 'AMRAP', restSeconds: 60 },
      ],
    });
    expect(
      weeklySummary(state, '2026-10-19').sportBreakdown[0]!.planned.elevationMeters,
    ).toMatchObject({ value: 0, missingCount: 0 });
    expect(() => create({ notes: narrative + 'x' })).toThrow();
    const redacted = boundedContext(state, { from: day, to: day, includeNotes: false });
    expect(redacted.workouts[0]).toMatchObject({
      notes: '',
      plannedElevationGainMeters: 0,
      sportSubgroup: 'mountaineering',
      exercises: [
        {
          name: 'Squat',
          sets: 3,
          repetitions: '8–10',
          weightKg: 20,
          loadDescription: 'per hand',
          instructions: '',
        },
        { name: 'Plank' },
        { name: 'Pull-up' },
      ],
    });
    expect(() =>
      assertReadableSources(
        [
          {
            action: 'workout.duplicate',
            id: id(1),
            expectedRevision: 1,
            values: { schedule: base.schedule },
          },
        ],
        state,
        { from: day, to: day, includeNotes: false },
      ),
    ).toThrow(/notes/);
    expect(
      workoutSchema.parse({ ...base, sport: 'running', sportSubgroup: undefined, revision: 1 }),
    ).toMatchObject({ sport: 'running', completion: null });
  });
});
