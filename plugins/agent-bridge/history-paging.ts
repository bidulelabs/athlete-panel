import { HISTORY_PAGE_BYTES, type HistoryResponse } from '@athlete-panel/contracts';
import { assert } from '../../packages/host/src/errors';

/** Serialize each item once for sizing. Leave room for the authenticated next cursor. Never skip an item. */
export function boundedHistoryPage<T>(
  rows: Iterable<T>,
  response: HistoryResponse,
  limit: number,
  cursorFor: (last: T) => string,
  error: { code: string; message: string },
) {
  const items: T[] = [];
  let bytes = Buffer.byteLength(JSON.stringify(response)) + 20000;
  let nextCursor: string | null = null;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (items.length === limit || bytes + size > HISTORY_PAGE_BYTES) {
      const last = items.at(-1);
      assert(last !== undefined, error.code, error.message, 413);
      nextCursor = cursorFor(last);
      break;
    }
    items.push(row);
    bytes += size;
  }
  return { items, nextCursor };
}
