/** Explicit product composition: host infrastructure has no training tables or rules. */
import { athleteRepository } from '../plugins/athlete/repository';
import { trainingRepository } from '../plugins/training/repository';
import { recordsRepository } from '../plugins/activity-records/repository';
import {
  type EntityKind,
  type Entity,
  type EntityChange,
  type WorkspaceState,
  emptyWorkspace,
  profileSchema,
} from '../packages/contracts/src';
import { type Transaction } from '../packages/host/src/db';
import { validateWorkspace } from '../plugins/training/engine';

export const repositories = {
  profile: athleteRepository,
  injury: athleteRepository,
  plan: trainingRepository,
  workout: trainingRepository,
  note: trainingRepository,
  event: trainingRepository,
  activity: recordsRepository,
  health: recordsRepository,
};
export const collections = {
  plan: 'plans',
  workout: 'workouts',
  note: 'notes',
  event: 'events',
  injury: 'injuries',
  activity: 'activities',
  health: 'health',
} as const;
export type WorkspaceLoadOptions = {
  /** Full reads are for explicit exports/tests. Runtime mutations load linked facts plus named records. */
  records?: 'all' | 'linked';
  activityIds?: readonly string[];
  activityExternalIds?: readonly string[];
  healthIds?: readonly string[];
  healthExternalIds?: readonly string[];
};
export async function loadProfile(tx?: Transaction): Promise<WorkspaceState['profile']> {
  const values = await athleteRepository.list('profile', tx);
  return values[0] ? profileSchema.parse(values[0]) : null;
}
export async function loadWorkspace(
  tx?: Transaction,
  range?: { from: string; to: string },
  options: WorkspaceLoadOptions = {},
): Promise<WorkspaceState> {
  const state = emptyWorkspace();
  for (const [kind, repository] of Object.entries(repositories)) {
    const imported = kind === 'activity' || kind === 'health';
    const selected = imported && (range !== undefined || options.records === 'linked');
    const values = selected
      ? await repository.select(
          kind,
          {
            range,
            ids:
              kind === 'activity'
                ? [
                    ...state.workouts.flatMap((w) =>
                      w.completion?.activityId ? [w.completion.activityId] : [],
                    ),
                    ...(options.activityIds ?? []),
                  ]
                : options.healthIds,
            externalIds:
              kind === 'activity' ? options.activityExternalIds : options.healthExternalIds,
          },
          tx,
        )
      : await repository.list(kind, tx);
    if (kind === 'profile') state.profile = (values[0] ?? null) as WorkspaceState['profile'];
    else
      (state as unknown as Record<string, unknown>)[collections[kind as keyof typeof collections]] =
        values;
  }
  return validateWorkspace(state);
}
export function findEntity(state: WorkspaceState, kind: EntityKind, id: string): Entity | null {
  return kind === 'profile'
    ? state.profile
    : (state[collections[kind]].find((e) => e.id === id) ?? null);
}
export async function persistChanges(changes: EntityChange[], tx: Transaction) {
  for (const change of changes)
    if (change.before === null && change.after?.revision === 1) {
      for (const repository of new Set(Object.values(repositories))) {
        const old =
          await tx`select id from ${tx(repository.schema + '.records')} where id=${change.id} limit 1`;
        if (old.length)
          throw new (await import('../packages/host/src/errors')).AppError(
            'reserved_identity',
            'This identity belongs to an existing or deleted record.',
            409,
          );
      }
    }
  // Release old unique associations before installing the final transaction state.
  for (const change of changes)
    if (change.before) await repositories[change.entity].remove(change.entity, change.id, tx);
  for (const change of changes)
    if (change.after) await repositories[change.entity].save(change.entity, change.after, tx);
}
