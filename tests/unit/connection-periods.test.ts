import { describe, expect, it } from 'vitest';
import { historyScopeSchema } from '@athlete-panel/contracts';
import { historyAnniversaryStart } from '../../plugins/agent-bridge/connection-periods';

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
