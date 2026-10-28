import postgres, { type Sql, type TransactionSql } from 'postgres';
import { AppError } from './errors';

const globals = globalThis as unknown as { athletePanelSql?: Sql };
export function connection(): Sql {
  if (!process.env.DATABASE_URL)
    throw new AppError('database_unconfigured', 'DATABASE_URL is required.', 503);
  return (globals.athletePanelSql ??= postgres(process.env.DATABASE_URL, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  }));
}
export type Transaction = TransactionSql;
export async function transaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  options: { allowMaintenance?: boolean } = {},
): Promise<T> {
  // Single owner: serialize domain writes and context freshness under one transaction lock.
  // This also covers imports and proposal application, including phantom insertions.
  return (await connection().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    const maintenance = await tx`select value from host.settings where key='maintenance'`;
    if (maintenance[0]?.value === true && !options.allowMaintenance)
      throw new AppError('maintenance', 'The instance is in maintenance mode.', 503);
    return fn(tx);
  })) as T;
}

export async function closeDatabase() {
  if (globals.athletePanelSql) {
    await globals.athletePanelSql.end();
    delete globals.athletePanelSql;
  }
}
