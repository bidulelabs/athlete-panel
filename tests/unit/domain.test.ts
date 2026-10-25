import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Activity, type CommandInput, type WorkspaceState } from '@athlete-panel/contracts';
import { applyCommands, DomainError, validateWorkspace } from '../../plugins/training/engine';
import { activityLocalDate, addDays, distanceFromMeters, distanceToMeters, effectiveDate } from '../../plugins/training/dates';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const owner = { actor: 'owner' as const };
const run = (state: WorkspaceState, commands: CommandInput[]) => applyCommands(state, commands, owner);
function training(): WorkspaceState {
  return run(emptyWorkspace(), [
    { action: 'plan.create', values: { id: id(1), title: 'Build', startDate: '2026-10-19' } },
    { action: 'workout.create', values: { id: id(2), title: 'Ride', sport: 'cycling', schedule: { kind: 'plan', planId: id(1), day: 6 }, durationSeconds: 3600, distanceMeters: 30000 } },
    { action: 'workout.create', values: { id: id(3), title: 'Run', sport: 'running', schedule: { kind: 'independent', date: '2026-10-24' }, order: 2 } },
  ]).state;
}
function activity(): Activity {
  return { id: id(9), revision: 1, provider: 'garmin', externalId: 'activity-9', title: 'Morning ride', sport: 'cycling', startedAt: '2026-10-24T06:00:00Z', localDate: '2026-10-24', dateSource: 'provider', durationSeconds: 4000, distanceMeters: 32000, elevationMeters: null, averageHeartRateBpm: null };
}

describe('pure training engine', () => {
  it('atomically rejects a batch and never changes its input', () => {
    const state = training();
    const copy = structuredClone(state);
    expect(() => run(state, [
      { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'Would change' } },
      { action: 'workout.update', id: id(99), expectedRevision: 1, values: { title: 'Missing' } },
    ])).toThrow(DomainError);
    expect(state).toEqual(copy);
  });
  it('rejects stale revisions and increments each changed entity once per batch', () => {
    const state = training();
    expect(() => run(state, [{ action: 'workout.update', id: id(2), expectedRevision: 2, values: { title: 'Stale' } }])).toThrow(/changed/);
    const result = run(state, [
      { action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'New' } },
      { action: 'workout.update', id: id(2), expectedRevision: 1, values: { notes: 'Second change' } },
    ]);
    expect(result.state.workouts.find((item) => item.id === id(2))?.revision).toBe(2);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.find((change) => change.id === id(2))?.before).toMatchObject({ title: 'Ride' });
    expect(result.changes.find((change) => change.id === id(2))?.after).toMatchObject({ title: 'New', notes: 'Second change' });
    expect(result.state.plans[0].revision).toBe(2);
    expect(() => run(result.state, [{ action: 'plan.delete', id: id(1), expectedRevision: 1 }])).toThrow(/changed/);
  });
  it('resolves independent and plan-relative dates without stale copies', () => {
    const state = training();
    expect(effectiveDate(state.workouts[0], state.plans)).toBe('2026-10-24');
    const shifted = run(state, [{ action: 'plan.update', id: id(1), expectedRevision: 1, values: { startDate: '2026-10-20' } }]).state;
    expect(effectiveDate(shifted.workouts[0].schedule, shifted.plans)).toBe('2026-10-25');
    expect(effectiveDate(shifted.workouts[1], shifted.plans)).toBe('2026-10-24');
    const unscheduled = run(state, [{ action: 'plan.update', id: id(1), expectedRevision: 1, values: { startDate: null } }]).state;
    expect(effectiveDate(unscheduled.workouts[0], unscheduled.plans)).toBeNull();
    expect(unscheduled.workouts).toHaveLength(2);
  });
  it('expands plan date changes into child revisions and reviewable derived dates', () => {
    const state = training();
    const result = run(state, [{ action: 'plan.update', id: id(1), expectedRevision: 1, values: { startDate: '2026-10-20' } }]);
    expect(result.changes.find((change) => change.id === id(2))).toMatchObject({
      beforeEffectiveDate: '2026-10-24', afterEffectiveDate: '2026-10-25',
      before: { revision: 1 }, after: { revision: 2 },
    });
    expect(() => run(result.state, [{ action: 'workout.update', id: id(2), expectedRevision: 1, values: { title: 'Stale date context' } }])).toThrow(/changed/);
  });
  it('rejects completion on an unscheduled plan and preserves actual date independently', () => {
    const state = training();
    const pending = run(state, [{ action: 'plan.update', id: id(1), expectedRevision: 1, values: { startDate: null } }]).state;
    const complete: CommandInput = { action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'completed', performedDate: '2026-10-25', durationSeconds: 3000 } };
    expect(() => run(pending, [{ ...complete, expectedRevision: 2 }])).toThrow(/Schedule/);
    expect(run(state, [complete]).state.workouts[0].completion?.performedDate).toBe('2026-10-25');
  });
  it('guards history against whole-plan shifts, deletion and workout rescheduling', () => {
    const state = run(training(), [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'completed', performedDate: '2026-10-24', durationSeconds: 3600 } }]).state;
    for (const command of [
      { action: 'plan.update', id: id(1), expectedRevision: 2, values: { startDate: null } },
      { action: 'plan.delete', id: id(1), expectedRevision: 2 },
      { action: 'workout.update', id: id(2), expectedRevision: 2, values: { schedule: { kind: 'independent', date: '2026-10-25' } } },
      { action: 'workout.delete', id: id(2), expectedRevision: 2 },
    ] as CommandInput[]) expect(() => run(state, [command])).toThrow(/history|completion/i);
    expect(run(state, [{ action: 'workout.update', id: id(3), expectedRevision: 1, values: { schedule: { kind: 'independent', date: '2026-10-25' } } }]).state.workouts[1].schedule).toEqual({ kind: 'independent', date: '2026-10-25' });
  });
  it('duplicates plans with deterministic child IDs and clears every completion/link', () => {
    const state = training();
    state.activities.push(activity());
    const linked = run(state, [{ action: 'workout.link', id: id(2), expectedRevision: 1, activityId: id(9) }]).state;
    const command: CommandInput = { action: 'plan.duplicate', id: id(1), expectedRevision: 2, values: { id: id(5), title: 'Next build', startDate: '2026-11-01' } };
    const first = run(linked, [command]);
    expect(first).toEqual(run(linked, [command]));
    const copy = first.state.workouts.find((item) => item.schedule.kind === 'plan' && item.schedule.planId === id(5));
    expect(copy).toMatchObject({ title: 'Ride', completion: null, revision: 1, durationSeconds: 3600 });
    expect(copy?.id).not.toBe(id(2));
    expect(first.state.activities).toHaveLength(1);
  });
  it('records partial/skipped completion correctly and permits deliberate clearing', () => {
    expect(() => run(training(), [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'partial', performedDate: '2026-10-24' } }])).toThrow();
    const skipped = run(training(), [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'skipped', performedDate: '2026-10-24', durationSeconds: 4000, distanceMeters: 20000, rpe: 5 } }]).state;
    expect(skipped.workouts[0].completion).toMatchObject({ status: 'skipped', durationSeconds: null, distanceMeters: null, rpe: null });
    expect(run(skipped, [{ action: 'workout.clearCompletion', id: id(2), expectedRevision: 2 }]).state.workouts[0].completion).toBeNull();
  });
  it('links once, replaces manual numbers, and unlinks without resurrecting them', () => {
    const state = training(); state.activities.push(activity());
    const manual = run(state, [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'partial', performedDate: '2026-10-24', durationSeconds: 1200, reason: 'Time', rpe: 4 } }]).state;
    const result = run(manual, [{ action: 'workout.link', id: id(2), expectedRevision: 2, activityId: id(9) }]);
    expect(result.state.workouts[0].completion).toMatchObject({ source: 'garmin', durationSeconds: 4000, rpe: 4 });
    expect(result.changes.find((change) => change.id === id(2))?.before).toMatchObject({ completion: { durationSeconds: 1200 } });
    const unlinked = run(result.state, [{ action: 'workout.unlink', id: id(2), expectedRevision: 3 }]).state;
    expect(unlinked.workouts[0].completion).toBeNull();
    expect(unlinked.activities).toEqual(state.activities);
  });
  it('rejects duplicate links, mismatched sport and implicit imported completion clearing', () => {
    const state = training(); state.activities.push(activity());
    const linked = run(state, [{ action: 'workout.link', id: id(2), expectedRevision: 1, activityId: id(9) }]).state;
    expect(() => run(linked, [{ action: 'workout.clearCompletion', id: id(2), expectedRevision: 2 }])).toThrow(/unlink/i);
    expect(() => run(linked, [{ action: 'workout.link', id: id(3), expectedRevision: 1, activityId: id(9) }])).toThrow(/sport/);
    const withCopy = run(linked, [{ action: 'workout.duplicate', id: id(2), expectedRevision: 2, values: { id: id(4), schedule: { kind: 'independent', date: '2026-10-24' } } }]).state;
    expect(() => run(withCopy, [{ action: 'workout.link', id: id(4), expectedRevision: 1, activityId: id(9) }])).toThrow(/already linked/);
  });
  it('annotates linked partial completion without overriding provider actuals', () => {
    const state = training(); state.activities.push(activity());
    const linked = run(state, [{ action: 'workout.link', id: id(2), expectedRevision: 1, activityId: id(9) }]).state;
    const annotated = run(linked, [{ action: 'workout.complete', id: id(2), expectedRevision: 2, values: { status: 'partial', performedDate: '2026-10-24', durationSeconds: 4000, distanceMeters: 32000, rpe: 8, reason: 'Stopped intervals early' } }]).state;
    expect(annotated.workouts[0].completion).toMatchObject({ source: 'garmin', activityId: id(9), status: 'partial', rpe: 8, durationSeconds: 4000, distanceMeters: 32000 });
    expect(run(annotated, [{ action: 'workout.complete', id: id(2), expectedRevision: 3, values: { status: 'completed', performedDate: '2026-10-24', rpe: 7 } }]).state.workouts[0].completion?.durationSeconds).toBe(4000);
    for (const values of [
      { status: 'skipped', performedDate: '2026-10-24' },
      { status: 'completed', performedDate: '2026-10-25' },
      { status: 'completed', performedDate: '2026-10-24', durationSeconds: 1 },
      { status: 'completed', performedDate: '2026-10-24', distanceMeters: 1 },
    ] as const) expect(() => run(linked, [{ action: 'workout.complete', id: id(2), expectedRevision: 2, values }])).toThrow(/Unlink|Garmin/);
  });
  it('normalizes mixed-day ordering and audits changed siblings', () => {
    const state = training();
    const reordered = run(state, [{ action: 'workout.reorder', date: '2026-10-24', workouts: [{ id: id(3), expectedRevision: 1 }, { id: id(2), expectedRevision: 1 }] }]);
    expect(reordered.changes).toHaveLength(3);
    expect(reordered.state.workouts.map((item) => [item.id, item.order, item.revision])).toEqual([[id(2), 2, 2], [id(3), 1, 2]]);
    expect(() => run(state, [{ action: 'workout.reorder', date: '2026-10-24', workouts: [{ id: id(2), expectedRevision: 1 }] }])).toThrow(/every workout/);
    const deleted = run(reordered.state, [{ action: 'workout.delete', id: id(3), expectedRevision: 2 }]);
    expect(deleted.state.workouts[0]).toMatchObject({ order: 1, revision: 3 });
    expect(deleted.changes).toHaveLength(3);
  });
  it('restricts agent writes to pending prescription and notes', () => {
    const state = training();
    expect(() => applyCommands(state, [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'completed', performedDate: '2026-10-24' } }], { actor: 'agent' })).toThrow(/not available/);
    const completed = run(state, [{ action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'completed', performedDate: '2026-10-24' } }]).state;
    expect(() => applyCommands(completed, [{ action: 'workout.update', id: id(2), expectedRevision: 2, values: { title: 'No' } }], { actor: 'agent' })).toThrow(/pending/);
    expect(applyCommands(state, [{ action: 'workout.update', id: id(2), expectedRevision: 1, values: { durationSeconds: 1800 } }], { actor: 'agent' }).state.workouts[0].durationSeconds).toBe(1800);
  });
  it('validates context records and rejects backwards injury dates after a partial update', () => {
    const state = run(emptyWorkspace(), [
      { action: 'profile.set', expectedRevision: null, values: { displayName: 'Owner', timezone: 'Europe/Paris' } },
      { action: 'event.create', values: { id: id(1), title: 'Race', date: '2026-11-01' } },
      { action: 'injury.create', values: { id: id(2), bodyPart: 'Knee', startDate: '2026-10-24' } },
      { action: 'note.create', values: { id: id(3), title: 'Rest', body: 'Easy week', schedule: { kind: 'independent', date: '2026-10-24' } } },
    ]).state;
    expect(state.profile?.revision).toBe(1);
    expect(() => run(state, [{ action: 'injury.update', id: id(2), expectedRevision: 1, values: { endDate: '2026-10-20' } }])).toThrow(/End date/);
    expect(() => run(state, [{ action: 'profile.set', expectedRevision: null, values: {} }])).toThrow(/changed/);
    expect(validateWorkspace(state)).toEqual(state);
  });
});

describe('date and unit arithmetic', () => {
  it('crosses daylight-saving transitions and leap days as floating dates', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(activityLocalDate('2026-10-24T23:30:00Z', 7200)).toBe('2026-10-25');
    expect(activityLocalDate('2026-10-24T01:30:00Z', -18000)).toBe('2026-10-23');
  });
  it('converts displayed distance only at the boundary', () => {
    expect(distanceToMeters(1, 'imperial')).toBe(1609.344);
    expect(distanceFromMeters(distanceToMeters(42.195, 'metric'), 'metric')).toBeCloseTo(42.195);
    expect(distanceFromMeters(distanceToMeters(26.2, 'imperial'), 'imperial')).toBeCloseTo(26.2);
  });
});
