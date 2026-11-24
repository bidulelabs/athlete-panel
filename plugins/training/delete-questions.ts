import type { Plan, Workout, WorkspaceState } from '@athlete-panel/contracts';

export function eventDeleteQuestion(state: WorkspaceState, eventId: string): string | null {
  const hasRacePlan = state.racePlans.some((racePlan) => racePlan.eventId === eventId);
  const hasRehearsals = state.rehearsals.some((rehearsal) => rehearsal.eventId === eventId);
  if (hasRacePlan && hasRehearsals)
    return 'Delete this event, its race plan and its fueling rehearsals?';
  if (hasRacePlan) return 'Delete this event and its race plan?';
  if (hasRehearsals) return 'Delete this event and its fueling rehearsals?';
  return null;
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
