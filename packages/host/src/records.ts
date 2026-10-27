import type { ZodType } from 'zod';
import { AppError } from './errors';
import { and, eq } from 'drizzle-orm';
import { database, recordTable, type Transaction } from './db';
import { connection } from './db';

export type StoredRecord = { id: string; revision: number; [key: string]: unknown };
export type RecordSelection = {
  range?: { from: string; to: string };
  ids?: readonly string[];
  externalIds?: readonly string[];
};
/** A plugin receives a repository for its own declared schema, never another plugin's ORM types. */
export class RecordRepository<T extends StoredRecord> {
  readonly table;
  constructor(
    readonly schema: string,
    private readonly schemas: Record<string, ZodType<T>>,
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema');
    this.table = recordTable(schema);
  }
  async list(kind: string, tx?: Transaction): Promise<T[]> {
    if (tx) {
      const rows = await tx<
        { data: unknown }[]
      >`select data from ${tx(this.schema + '.records')} where kind=${kind} and deleted=false order by id`;
      return rows.map((row) => this.parse(kind, row.data));
    }
    const rows = await database()
      .select({ data: this.table.data })
      .from(this.table)
      .where(and(eq(this.table.kind, kind), eq(this.table.deleted, false)))
      .orderBy(this.table.id);
    return rows.map((row) => this.parse(kind, row.data));
  }
  async range(
    kind: string,
    from: string,
    to: string,
    includeIds: string[] = [],
    tx?: Transaction,
  ): Promise<T[]> {
    return this.select(kind, { range: { from, to }, ids: includeIds }, tx);
  }
  /** The caller names the records needed for a projection or transaction; no filter means no rows. */
  async select(kind: string, selection: RecordSelection, tx?: Transaction): Promise<T[]> {
    const ids = [...new Set(selection.ids ?? [])],
      externalIds = [...new Set(selection.externalIds ?? [])];
    if (!selection.range && !ids.length && !externalIds.length) return [];
    const sql = tx ?? connection(),
      range = selection.range;
    const dateMatch = range
      ? sql`(data->>'localDate'>=${range.from} and data->>'localDate'<=${range.to})`
      : sql`false`;
    const rows = await sql<
      { data: unknown }[]
    >`select data from ${sql(this.schema + '.records')} where kind=${kind} and deleted=false
      and (${dateMatch} or id=any(${ids}) or data->>'externalId'=any(${externalIds})) order by id`;
    return rows.map((row) => this.parse(kind, row.data));
  }
  private parse(kind: string, value: unknown): T {
    const schema = this.schemas[kind];
    if (!schema)
      throw new AppError('invalid_record_kind', 'Unsupported repository record kind.', 500);
    return schema.parse(value);
  }
  async save(kind: string, record: StoredRecord, tx: Transaction) {
    this.parse(kind, record);
    await tx`insert into ${tx(this.schema + '.records')} (kind,id,revision,data,deleted) values (${kind},${record.id},${record.revision},${tx.json(record as never)},false)
      on conflict (kind,id) do update set revision=excluded.revision,data=excluded.data,deleted=false,updated_at=now()`;
  }
  async remove(kind: string, id: string, tx: Transaction) {
    await tx`update ${tx(this.schema + '.records')} set deleted=true,revision=revision+1,updated_at=now() where kind=${kind} and id=${id}`;
  }
}
