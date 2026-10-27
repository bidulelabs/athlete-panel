import { connection } from './db';
import { digest } from './crypto';
import { RateLimitError } from './errors';

export type RequestBudget = {
  namespace: string;
  windowSeconds: number;
  clientLimit: number;
  totalLimit: number;
};

/** Admission commits independently of the subsequent operation and domain lock. */
export async function consumeRequestBudget(policy: RequestBudget, client: string) {
  const clientKey = `client:${digest(client)}`;
  const retryAfter = await connection().begin(async (tx) => {
    // A separate two-key lock serializes only this small admission ledger.
    await tx`select pg_advisory_xact_lock(736147003,hashtext(${policy.namespace}))`;
    await tx`delete from host.request_budgets where namespace=${policy.namespace} and reset_at<=now()`;
    const rows = await tx<{ key: string; count: number; retry: number }[]>`
      select key,count,greatest(1,ceil(extract(epoch from reset_at-now())))::int as retry
      from host.request_budgets where namespace=${policy.namespace} and key in (${clientKey},'global')`;
    const exceeded = rows.filter(
      (row) => row.count >= (row.key === 'global' ? policy.totalLimit : policy.clientLimit),
    );
    if (exceeded.length) return Math.max(...exceeded.map((row) => row.retry));
    for (const key of [clientKey, 'global']) {
      await tx`insert into host.request_budgets(namespace,key,count,reset_at)
        values(${policy.namespace},${key},1,now()+make_interval(secs=>${policy.windowSeconds}::int))
        on conflict(namespace,key) do update set count=host.request_budgets.count+1`;
    }
    return 0;
  });
  if (retryAfter) throw new RateLimitError(retryAfter);
}
