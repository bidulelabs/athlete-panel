import type { Transaction } from '../../packages/host/src/db';
import { loadWorkspace } from '../../instance/services';
import { persistAndAudit } from '../../instance/commit';
import { applyCommands } from './engine';
import { automaticActivityMatches } from './activity-matching';

/** Caller owns the domain lock and supplies the earliest importing job's durable creation time. */
export async function autoLinkImportedActivities(
  tx: Transaction,
  date: string,
  activityIds: string[],
  importsStartedAt: Date,
) {
  if (!activityIds.length) return 0;
  const state = await loadWorkspace(tx, { from: date, to: date });
  // A manual link followed by unlink/undo while this scan was pending is an explicit decision.
  // Newly inserted IDs cannot have associations before their import jobs began. Keep that
  // lower bound across retries; the activity's performed date or matching job start is unsafe.
  const prior = await tx<{ id: string }[]>`
    select distinct coalesce(change->'after'->'completion'->>'activityId', change->'before'->'completion'->>'activityId') as id
    from host.changes, lateral jsonb_array_elements(changes) as change
    where created_at >= ${importsStartedAt} and change->>'entity'='workout' and
      (change->'after'->'completion'->>'activityId'=any(${activityIds}) or
       change->'before'->'completion'->>'activityId'=any(${activityIds}))`;
  const excluded = new Set(prior.map((row) => row.id));
  const eligible = new Set(activityIds.filter((id) => !excluded.has(id)));
  const commands = automaticActivityMatches(state, eligible);
  // Each association is independently reviewable and undoable; imported facts aren't in this audit.
  let current = state;
  for (const command of commands) {
    const result = applyCommands(current, [command], { actor: 'owner', linkMethod: 'automatic' });
    await persistAndAudit(tx, result.changes, 'workout.autoLink', 'system');
    current = result.state;
  }
  return commands.length;
}
