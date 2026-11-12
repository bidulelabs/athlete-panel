import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { planSchema, workoutSchema, type ProposalDetails } from '@athlete-panel/contracts';
import { ProposedEdits } from '../../plugins/agent-bridge/proposal-changes';
import { addDays } from '../../plugins/training/dates';

vi.mock('@athlete-panel/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@athlete-panel/ui')>()),
  useWorkspace: () => ({ data: { profile: { units: 'metric' } }, weekStartsOn: 1 }),
}));

function changes(
  count: number,
  entity: 'workout' | 'plan' = 'workout',
): ProposalDetails['changes'] {
  return Array.from({ length: count }, (_, index) => {
    const record = {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      revision: 1,
      title: `Synthetic result ${index}`,
    };
    const base = { id: record.id, before: null };
    const date = addDays('2027-01-01', index % 365);
    return entity === 'plan'
      ? { ...base, entity: 'plan', after: planSchema.parse(record) }
      : {
          ...base,
          entity: 'workout',
          afterEffectiveDate: date,
          after: workoutSchema.parse({
            ...record,
            sport: 'running',
            schedule: { kind: 'independent', date },
          }),
        };
  });
}

const render = (records: ProposalDetails['changes'], filtered: boolean) =>
  renderToStaticMarkup(
    createElement(ProposedEdits, {
      changes: records,
      planTitles: {},
      filtered,
      collapsed: !filtered,
    }),
  );

describe('proposal review rendering budget', () => {
  it('opens up to 200 filtered matches across months', () => {
    const html = render(changes(200), true);
    expect(html.match(/class="proposal-diff"/g)).toHaveLength(200);
    expect(html).toContain('Synthetic result 199');
  });

  it.each([201, 1500])('defers rows for %i broad filter matches', (count) => {
    const html = render(changes(count), true);
    expect(html).toContain('proposal-month');
    expect(html).not.toContain('class="proposal-diff"');
    expect(html).not.toContain('Synthetic result');
  });

  it('keeps the annual proposal collapsed without filters', () => {
    expect(render(changes(1500), false)).not.toContain('Synthetic result');
  });

  it('also defers a broad result containing undated plans', () => {
    const html = render(changes(201, 'plan'), true);
    expect(html).toContain('201 plans');
    expect(html).not.toContain('Synthetic result');
  });
});
