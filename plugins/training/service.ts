import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commandsSchema, type EntityChange } from '../../packages/contracts/src';
import { transaction, type Transaction } from '../../packages/host/src/db';
import { canonical } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import { loadWorkspace, persistChanges, repositories, findEntity } from '../../instance/services';
import { applyCommands, validateWorkspace } from './engine';

export { idempotent } from '../../packages/host/src/idempotency';
import { idempotent } from '../../packages/host/src/idempotency';

export async function audit(
  tx: Transaction,
  changes: EntityChange[],
  summary: string,
  actor = 'owner',
) {
  const id = randomUUID();
  await tx`insert into host.changes(id,summary,changes,actor) values(${id},${summary},${tx.json(changes as never)},${actor})`;
  return id;
}
export async function mutate(body: unknown) {
  const input = z
    .object({ commands: commandsSchema, idempotencyKey: z.uuid() })
    .strict()
    .parse(body);
  return transaction((tx) =>
    idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'mutate', commands: input.commands },
      async () => {
        const activityIds = input.commands.flatMap((command) =>
          command.action === 'workout.link' ? [command.activityId] : [],
        );
        const result = applyCommands(
          await loadWorkspace(tx, undefined, { records: 'linked', activityIds }),
          input.commands,
          { actor: 'owner' },
        );
        await persistChanges(result.changes, tx);
        const id = await audit(tx, result.changes, input.commands.map((c) => c.action).join(', '));
        return { id, changes: result.changes };
      },
    ),
  );
}
export async function undoChange(body: unknown) {
  const input = z.object({ id: z.uuid(), idempotencyKey: z.uuid() }).strict().parse(body);
  return transaction((tx) =>
    idempotent(tx, input.idempotencyKey, { operation: 'undo', id: input.id }, async () => {
      const [entry] = await tx`select * from host.changes where id=${input.id} for update`;
      assert(
        entry && !entry.undone_at,
        'undo_unavailable',
        'This change is missing or already undone.',
        409,
      );
      const state = await loadWorkspace(tx, undefined, { records: 'linked' });
      const original = entry.changes as EntityChange[];
      const changes: EntityChange[] = [];
      for (const change of original) {
        const current = findEntity(state, change.entity, change.id);
        assert(
          canonical(current) === canonical(change.after),
          'undo_conflict',
          'A later edit prevents restoring the whole change. No records were changed.',
          409,
        );
        // Revision monotonically increases on restoration, including deleted records.
        const [stored] =
          await tx`select revision from ${tx(repositories[change.entity].schema + '.records')} where kind=${change.entity} and id=${change.id}`;
        if (change.after === null)
          assert(
            stored?.revision === (change.before?.revision ?? 0) + 1,
            'undo_conflict',
            'A later change to the deleted record prevents restoring the whole change.',
            409,
          );
        const after = change.before
          ? {
              ...change.before,
              revision: Math.max(stored?.revision ?? 0, current?.revision ?? 0) + 1,
            }
          : null;
        changes.push({
          ...change,
          before: current,
          after,
          ...('beforeEffectiveDate' in change
            ? {
                beforeEffectiveDate: change.afterEffectiveDate,
                afterEffectiveDate: change.beforeEffectiveDate,
              }
            : {}),
        });
      }
      await persistChanges(changes, tx);
      validateWorkspace(await loadWorkspace(tx, undefined, { records: 'linked' }));
      const id = await audit(tx, changes, `Undo: ${entry.summary}`);
      await tx`update host.changes set undone_at=now(),undo_id=${id} where id=${input.id}`;
      return { id, changes };
    }),
  );
}
