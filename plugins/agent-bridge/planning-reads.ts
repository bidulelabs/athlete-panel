import type { WorkspaceState } from '../../packages/contracts/src';
import { canonical, digest } from '../../packages/host/src/crypto';
import { transaction, type Transaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';

export async function rememberPlanningRead(
  tx: Transaction,
  grantId: string,
  context: WorkspaceState,
) {
  const contextDigest = digest(canonical(context));
  await tx`insert into agent_bridge.planning_reads(grant_id,digest,snapshot)
    values(${grantId},${contextDigest},${tx.json(context as never)})
    on conflict (grant_id,digest) do nothing`;
  return contextDigest;
}

export function forgetExpiredReads() {
  return transaction(async (tx) => {
    await tx`delete from agent_bridge.planning_reads r using host.grants g
      where r.grant_id=g.id and g.expires_at<=now()`;
  });
}

export async function proposalBaseline(
  tx: Transaction,
  grantId: string,
  readDigest: string,
  current: WorkspaceState,
) {
  const [read] = await tx<
    { snapshot: WorkspaceState }[]
  >`select snapshot from agent_bridge.planning_reads
    where grant_id=${grantId} and digest=${readDigest}`;
  // Replace only the two permitted collections. Every other field must still match the read.
  assert(
    read &&
      digest(
        canonical({
          ...current,
          activities: read.snapshot.activities,
          health: read.snapshot.health,
        }),
      ) === readDigest,
    'stale_context',
    'Training context changed. Read it again and review your proposal.',
    409,
  );
  return read.snapshot;
}
