import { it, expect } from 'vitest';
import { HistorySummaryCache } from '../../plugins/agent-bridge/history-summary-cache';
import { historySummarySchema } from '@athlete-panel/contracts';
const rows = [
  historySummarySchema.parse({
    category: 'activities',
    from: '2024-01-01',
    to: '2024-01-31',
    periodStart: '2024-01-01',
    partial: false,
    calendarDays: 31,
    count: 0,
    reference: {},
  }),
];

it('bounds retained summaries by bytes and least-recently-used entries', () => {
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  const cache = new HistorySummaryCache(bytes * 2, 2, 100);
  cache.put('a', rows, 1000, 0);
  cache.put('b', rows, 1000, 0);
  expect(cache.get('a', 1)).toEqual(rows);
  cache.put('c', rows, 1000, 2);
  expect(cache.get('b', 3)).toBeUndefined();
  expect(cache.get('a', 3)).toEqual(rows);
  cache.put('oversized', [...rows, ...rows, ...rows], 1000, 4);
  expect(cache.get('oversized', 5)).toBeUndefined();
  expect(cache.get('c', 5)).toEqual(rows);
});

it('expires at the earlier of TTL and access expiry, without extending TTL on reads', () => {
  const cache = new HistorySummaryCache(10000, 8, 100);
  cache.put('ttl', rows, 1000, 0);
  cache.put('grant', rows, 40, 0);
  expect(cache.get('ttl', 99)).toEqual(rows);
  expect(cache.get('ttl', 100)).toBeUndefined();
  expect(cache.get('grant', 100)).toBeUndefined();
  cache.put('expired', rows, 10, 20);
  expect(cache.get('expired', 20)).toBeUndefined();
});
