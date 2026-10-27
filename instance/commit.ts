import type { EntityChange } from '../packages/contracts/src';
import type { Transaction } from '../packages/host/src/db';
import { audit } from '../packages/host/src/audit';
import { persistChanges } from './services';
/** The caller retains authorization, idempotency and transaction ownership, including no-op audits. */
export async function persistAndAudit(
  tx: Transaction,
  changes: EntityChange[],
  summary: string,
  actor = 'owner',
): Promise<string> {
  await persistChanges(changes, tx);
  return audit(tx, changes, summary, actor);
}
