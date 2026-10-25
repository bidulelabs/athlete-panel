import postgres, { type Sql, type TransactionSql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pgSchema, text, integer, jsonb, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { AppError } from './errors';

const globals = globalThis as unknown as { athletePanelSql?: Sql; athletePanelReadSql?:Sql };
export function connection(): Sql {
  if (!process.env.DATABASE_URL) throw new AppError('database_unconfigured', 'DATABASE_URL is required.', 503);
  return globals.athletePanelSql ??= postgres(process.env.DATABASE_URL, { max: 8, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
}
export function database() {
  // Drizzle installs JSON serializers on its driver. Keep raw transaction serialization independent.
  if(!process.env.DATABASE_URL)throw new AppError('database_unconfigured','DATABASE_URL is required.',503);
  return drizzle(globals.athletePanelReadSql ??= postgres(process.env.DATABASE_URL,{max:4,idle_timeout:20,onnotice:()=>{}}));
}
export type Transaction = TransactionSql;
export function recordTable(schemaName: string) {
  return pgSchema(schemaName).table('records', {
    kind: text('kind').notNull(), id: text('id').notNull(), revision: integer('revision').notNull(),
    data: jsonb('data').notNull(), deleted: boolean('deleted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }, table => [primaryKey({ columns: [table.kind, table.id] })]);
}
export const hostSchema = pgSchema('host');
export const settingsTable = hostSchema.table('settings', { key: text('key').primaryKey(), value: jsonb('value').notNull() });

export async function transaction<T>(fn: (tx: Transaction) => Promise<T>,options:{allowMaintenance?:boolean}={}): Promise<T> {
  // Single owner: serialize domain writes and context freshness under one transaction lock.
  // This also covers imports and proposal application, including phantom insertions.
  return await connection().begin(async tx => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    const maintenance = await tx`select value from host.settings where key='maintenance'`;
    if (maintenance[0]?.value === true&&!options.allowMaintenance) throw new AppError('maintenance', 'The instance is in maintenance mode.', 503);
    return fn(tx);
  }) as T;
}

export async function closeDatabase() { if (globals.athletePanelSql) { await globals.athletePanelSql.end(); delete globals.athletePanelSql; } if(globals.athletePanelReadSql){await globals.athletePanelReadSql.end();delete globals.athletePanelReadSql;} }
