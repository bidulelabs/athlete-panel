import { randomUUID } from 'node:crypto';
import type { EntityChange } from '@athlete-panel/contracts';
import type { Transaction } from './db';
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
