import { describe, expect, it } from 'vitest';
import { historyScopeSchema } from '@athlete-panel/contracts';
import {
  historyAnniversaryStart,
  racesUpToOneYearAhead,
} from '../../plugins/agent-bridge/connection-periods';

describe('history presets respect the inclusive forward anniversary limit', () => {
  it.each([
    ['2026-10-31', 5, '2021-10-31'],
    ['2024-02-29', 1, '2023-03-01'],
    ['2024-02-29', 5, '2019-03-01'],
    ['2025-02-28', 1, '2024-02-28'],
    ['2026-01-01', 5, '2021-01-01'],
  ] as const)('%s minus %s years begins at %s', (today, years, expected) => {
    const from = historyAnniversaryStart(today, years);
    expect(from).toBe(expected);
    expect(
      historyScopeSchema.safeParse({ from, to: today, categories: ['training'], weekStartsOn: 1 })
        .success,
    ).toBe(true);
  });
});

describe('races a planning connection can prepare', () => {
  const event = (title: string, date: string, kind: 'race' | 'goal' = 'race') => ({
    id: `00000000-0000-4000-8000-${date.replaceAll('-', '').padStart(12, '0')}`,
    revision: 1,
    title,
    kind,
    date,
    notes: '',
  });

  it('keeps races from today to one year ahead, soonest first', () => {
    const races = racesUpToOneYearAhead(
      [
        event('In a year', '2027-11-16'),
        event('Yesterday', '2026-11-15'),
        event('Today', '2026-11-16'),
        event('A year and a day', '2027-11-17'),
        event('Spring goal', '2027-04-04', 'goal'),
        event('Spring race', '2027-04-05'),
      ],
      '2026-11-16',
    );
    expect(races.map((race) => race.title)).toEqual(['Today', 'Spring race', 'In a year']);
  });
});
