import type { Plan, Workout, WorkspaceState } from '@athlete-panel/contracts';

export function eventDeleteQuestion(state: WorkspaceState, eventId: string): string | null {
  const deletedWithRace = [
    state.racePlans.some((racePlan) => racePlan.eventId === eventId) && 'its race plan',
    state.raceScenarios.some((scenario) => scenario.eventId === eventId) && 'its race scenarios',
    state.rehearsals.some((rehearsal) => rehearsal.eventId === eventId) && 'its fueling rehearsals',
  ].filter((name) => name !== false);
  const last = deletedWithRace.pop();
  if (last === undefined) return null;
  return `Delete this event${deletedWithRace.map((name) => `, ${name}`).join('')} and ${last}?`;
}

export function workoutDeleteQuestion(state: WorkspaceState, workout: Workout): string {
  return state.rehearsals.some((rehearsal) => rehearsal.workoutId === workout.id)
    ? `Delete “${workout.title}” and its fueling rehearsals?`
    : `Delete “${workout.title}”?`;
}

export function planDeleteQuestion(
  state: WorkspaceState,
  plan: Plan,
  planWorkouts: readonly Workout[],
): string {
  return state.rehearsals.some((rehearsal) =>
    planWorkouts.some((workout) => workout.id === rehearsal.workoutId),
  )
    ? `Delete “${plan.title}”, its planned sessions and their fueling rehearsals?`
    : `Delete “${plan.title}” and its planned sessions?`;
}
