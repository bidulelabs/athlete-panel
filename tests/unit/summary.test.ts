import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Activity, type CommandInput } from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { summarizeRange, weeklySummary } from '../../plugins/training/summary';
import { startOfWeek } from '../../packages/ui/src/calendar-dates';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const owner = { actor: 'owner' as const };
const activity: Activity = { id: id(9), revision: 1, provider: 'garmin', externalId: 'ride', title: 'Ride', sport: 'cycling', startedAt: '2026-10-24T23:30:00Z', localDate: '2026-10-25', dateSource: 'provider', durationSeconds: 3600, distanceMeters: 30000, elevationMeters: null, averageHeartRateBpm: null };
const range = { startDate: '2026-10-19', endDate: '2026-10-25' };

function fixture() {
  const commands: CommandInput[] = [
    { action: 'workout.create', values: { id: id(1), title: 'Ride', sport: 'cycling', schedule: { kind: 'independent', date: '2026-10-24' }, durationSeconds: 5400, distanceMeters: 40000 } },
    { action: 'workout.create', values: { id: id(2), title: 'Run', sport: 'running', schedule: { kind: 'independent', date: '2026-10-24' }, durationSeconds: 1800, distanceMeters: 5000, order: 2 } },
    { action: 'workout.complete', id: id(1), expectedRevision: 1, values: { status: 'completed', performedDate: '2026-10-25', durationSeconds: 3000, distanceMeters: 25000 } },
    { action: 'workout.complete', id: id(2), expectedRevision: 1, values: { status: 'partial', performedDate: '2026-10-24', durationSeconds: 1200, distanceMeters: 3000, reason: 'Time' } },
  ];
  const state = applyCommands(emptyWorkspace(), commands, owner).state;
  state.activities.push(activity);
  return state;
}

describe('planned and actual volume', () => {
  it('moves Sunday actuals into the next week without changing their recorded dates', () => {
    const state = fixture();
    const before = JSON.stringify(state);
    const monday = weeklySummary(state, startOfWeek('2026-10-25', 1));
    const sunday = weeklySummary(state, startOfWeek('2026-10-25', 0));
    expect(monday.planned.durationSeconds.value).toBe(7200);
    expect(monday.actual.durationSeconds.value).toBe(7800);
    expect(sunday.planned.sessions).toBe(0);
    expect(sunday.actual.durationSeconds.value).toBe(6600);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('counts manual-only actuals and separates sports', () => {
    const state = fixture(); state.activities = [];
    const summary = weeklySummary(state, range.startDate);
    expect(summary.planned.durationSeconds.value).toBe(7200);
    expect(summary.actual.durationSeconds.value).toBe(4200);
    expect(summary.actual.distanceMeters.cycling.value).toBe(25000);
    expect(summary.actual.distanceMeters.running.value).toBe(3000);
  });
  it('counts a linked pair once and never resurrects manual actuals on unlink', () => {
    const state = fixture();
    expect(summarizeRange(state, range).possibleDuplicateWorkoutIds).toEqual([id(1)]);
    const linked = applyCommands(state, [{ action: 'workout.link', id: id(1), expectedRevision: 1, activityId: id(9) }], owner).state;
    expect(summarizeRange(linked, range).actual.durationSeconds.value).toBe(4800);
    expect(summarizeRange(linked, range).actual.sessions).toBe(2);
    const unlinked = applyCommands(linked, [{ action: 'workout.unlink', id: id(1), expectedRevision: 2 }], owner).state;
    expect(summarizeRange(unlinked, range).actual.durationSeconds.value).toBe(4800);
    expect(summarizeRange(unlinked, range).actual.sessions).toBe(2);
    expect(summarizeRange(unlinked, range).possibleDuplicateWorkoutIds).toEqual([]);
  });
  it('uses performed/import-local dates instead of planned or UTC dates', () => {
    const state = fixture(); state.activities = [];
    const saturday = summarizeRange(state, { startDate: '2026-10-24', endDate: '2026-10-24' });
    expect(saturday.planned.sessions).toBe(2);
    expect(saturday.actual.sessions).toBe(1);
    state.activities.push(activity);
    expect(summarizeRange(state, { startDate: '2026-10-25', endDate: '2026-10-25' }).actual.sessions).toBe(2);
  });
  it('distinguishes known zero, missing metrics and empty history', () => {
    const empty = summarizeRange(emptyWorkspace(), range);
    expect(empty.actual.durationSeconds).toEqual({ value: 0, knownCount: 0, missingCount: 0 });
    const state = emptyWorkspace(); state.activities.push({ ...activity, durationSeconds: null, distanceMeters: 0 });
    const summary = summarizeRange(state, range);
    expect(summary.actual.durationSeconds).toEqual({ value: null, knownCount: 0, missingCount: 1 });
    expect(summary.actual.distanceMeters.cycling).toEqual({ value: 0, knownCount: 1, missingCount: 0 });
  });
  it('defensively deduplicates provider identity, excludes skipped volume and rejects reversed ranges', () => {
    const state = emptyWorkspace(); state.activities.push(activity, { ...activity, id: id(10) });
    expect(summarizeRange(state, range).actual.sessions).toBe(1);
    expect(() => summarizeRange(state, { startDate: '2026-10-25', endDate: '2026-10-19' })).toThrow(/precede/);
    const manual = fixture(); manual.activities = [];
    const skipped = applyCommands(manual, [{ action: 'workout.complete', id: id(1), expectedRevision: 1, values: { status: 'skipped', performedDate: '2026-10-25' } }], owner).state;
    expect(summarizeRange(skipped, range).actual.sessions).toBe(1);
  });
});
