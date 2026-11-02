import { describe, expect, it } from 'vitest';
import { localDate } from '../../packages/ui/src/calendar-dates';
import {
  earliestHistoryEnd,
  historyRange,
  moveHistoryEnd,
  validHistoryEnd,
} from '../../plugins/health/history-range';

describe('Health history dates', () => {
  it('includes today and exactly the selected number of floating calendar days', () => {
    for (const [days, from] of [
      [7, '2026-10-27'],
      [30, '2026-10-04'],
      [90, '2026-08-05'],
    ] as const) {
      const range = historyRange('2026-11-02', days);
      expect(range.from).toBe(from);
      expect(range.dates).toHaveLength(days);
      expect(range.dates[0]).toBe(from);
      expect(range.dates.at(-1)).toBe('2026-11-02');
      expect(new Set(range.dates).size).toBe(days);
    }
  });

  it('uses the athlete date at midnight boundaries, independently of week starts', () => {
    const instant = new Date('2026-11-02T00:30:00Z');
    expect(historyRange(localDate(instant, 'America/Los_Angeles'), 30)).toMatchObject({
      from: '2026-10-03',
      to: '2026-11-01',
    });
    expect(historyRange(localDate(instant, 'Europe/Paris'), 30)).toMatchObject({
      from: '2026-10-04',
      to: '2026-11-02',
    });
    expect(historyRange('2028-03-01', 7).dates).toContain('2028-02-29');
    expect(historyRange('2027-01-02', 7).from).toBe('2026-12-27');
    expect(historyRange('2026-03-30', 7).from).toBe('2026-03-24');
  });

  it('moves by whole periods and clamps forward navigation to today', () => {
    expect(moveHistoryEnd('2026-11-02', 30, -1, '2026-11-02')).toBe('2026-10-03');
    expect(moveHistoryEnd('2026-10-03', 30, 1, '2026-11-02')).toBe('2026-11-02');
    expect(moveHistoryEnd('2026-10-30', 30, 1, '2026-11-02')).toBe('2026-11-02');
    expect(moveHistoryEnd(earliestHistoryEnd, 90, -1, '2026-11-02')).toBe(earliestHistoryEnd);
    expect(historyRange(earliestHistoryEnd, 90).from).toBe('0001-01-01');
    expect(moveHistoryEnd('9999-12-01', 90, 1, '9999-12-31')).toBe('9999-12-31');
  });

  it('rejects invalid, unsupported and future end dates', () => {
    for (const date of ['', '2026-02-29', '2026-11-03', '0001-01-01'])
      expect(validHistoryEnd(date, '2026-11-02')).toBe(false);
    expect(validHistoryEnd('2026-11-02', '2026-11-02')).toBe(true);
  });
});
