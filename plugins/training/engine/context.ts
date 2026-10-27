import { type Schedule, type Workout, type WorkspaceState } from '@athlete-panel/contracts';
import { randomUUID } from 'node:crypto';
import { fail } from './errors';
import { allEntities } from './state';
export type EngineOptions = { actor: 'owner' | 'agent'; idFactory?: () => string };
export function createCommandContext(
  initial: WorkspaceState,
  state: WorkspaceState,
  options: EngineOptions,
) {
  const reserved = new Set(allEntities(initial).map(({ value }) => value.id));

  const createId = (supplied?: string): string => {
    const id = supplied ?? options.idFactory?.() ?? randomUUID();
    if (reserved.has(id)) fail('DUPLICATE_ID', 'An entity with this ID already exists.', { id });
    reserved.add(id);
    return id;
  };
  const get = <T extends { id: string; revision: number }>(
    items: T[],
    id: string,
    expectedRevision: number,
  ): T => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return fail('NOT_FOUND', 'The requested item does not exist.', { id });
    if (item.revision !== expectedRevision)
      fail('STALE_REVISION', 'This item changed. Reload before saving.', {
        id,
        expectedRevision,
        currentRevision: item.revision,
      });
    return item;
  };
  const checkSchedule = (schedule: Schedule): void => {
    if (schedule.kind === 'plan' && !state.plans.some((plan) => plan.id === schedule.planId))
      fail('NOT_FOUND', 'The selected plan does not exist.');
  };
  const pendingForAgent = (workout: Workout): void => {
    if (options.actor === 'agent' && workout.completion !== null)
      fail('FORBIDDEN', 'Agents may edit pending workouts only.');
  };

  return { state, options, createId, get, checkSchedule, pendingForAgent };
}
export type CommandContext = ReturnType<typeof createCommandContext>;
