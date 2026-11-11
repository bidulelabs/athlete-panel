import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  grantSummarySchema,
  planSchema,
  proposalDetailsSchema,
  type GrantSummary,
  type ProposalSummary,
  type AuditSummary,
} from '../../packages/contracts/src';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('E2E_PASSWORD is required for the isolated synthetic instance.');
const dates = { from: '2026-11-01', to: '2026-11-30', includeNotes: false };
const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
const expiredAt = new Date(Date.now() - 60_000).toISOString();
function grant(label: string, overrides: Record<string, unknown> = {}): GrantSummary {
  return grantSummarySchema.parse({
    id: randomUUID(),
    label,
    expiresAt,
    revoked: false,
    version: 2,
    history: null,
    planning: dates,
    ...overrides,
  });
}
async function theme(page: Page, value: string) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    document.documentElement.classList.toggle('dark', value === 'dark');
  }, value);
}
async function workspace(
  page: Page,
  state: { grants: GrantSummary[]; proposals?: ProposalSummary[]; changes?: AuditSummary[] },
) {
  await page.route('**/api/workspace?*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        ...state,
        proposals: state.proposals ?? [],
        changes: state.changes ?? [],
      },
    });
  });
  await page.goto('/agent');
  await expect(page.getByRole('heading', { name: 'Agent workspace', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'wait' }));

test('empty page keeps the next action visible, with two accessible tabs and secondary history', async ({
  page,
}, info) => {
  await workspace(page, { grants: [] });
  await expect(page.getByRole('tab')).toHaveCount(2);
  for (const color of ['light', 'dark']) {
    await theme(page, color);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(
        page.getByRole('heading', { name: 'No proposals awaiting review' }),
      ).toBeInViewport();
      await expect(
        page.getByRole('button', { name: 'Connect an agent', exact: true }),
      ).toBeInViewport();
      await page.getByRole('tab', { name: 'Proposals', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Connected agents' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('tabpanel', { name: 'Connected agents' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No active connections' })).toBeInViewport();
      const tabs = await page
        .getByRole('tablist')
        .evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }));
      expect(tabs.scroll).toBeLessThanOrEqual(tabs.client);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        animations: 'disabled',
        path: `.runtime/browser/agent-empty-${info.project.name}-${width}-${color}.png`,
      });
      await page.getByRole('tab', { name: 'Proposals', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Change history' })).toContainText(
    'No changes yet',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Change history', exact: true })).toBeFocused();
  await expect(page.getByText(/Garmin keys and server secrets are excluded/)).toBeHidden();
  await page.getByText('About shared data', { exact: true }).click();
  await expect(page.getByText(/Garmin keys and server secrets are excluded/)).toBeVisible();
});

test('connection details retain exact scopes while inactive grants stay collapsed', async ({
  page,
}, info) => {
  const history = {
    ...dates,
    from: '2025-11-01',
    categories: ['activities', 'health'],
    weekStartsOn: 0,
    includeNotes: true,
  };
  const grants = [
    grant('Combined reviewer', { history, planning: { ...dates, allowEventCreation: true } }),
    grant('History reviewer', { history: { ...history, includeNotes: false }, planning: null }),
    grant('Planning reviewer', { planning: { ...dates, includeNotes: true } }),
    grantSummarySchema.parse({
      id: randomUUID(),
      label: 'Legacy reviewer',
      ...dates,
      expiresAt,
      revoked: false,
    }),
    grant('Expired reviewer', { expiresAt: expiredAt }),
    grant('Disconnected reviewer', { revoked: true }),
  ];
  await workspace(page, { grants });
  await page.getByRole('tab', { name: 'Connected agents' }).click();
  const row = (name: string) => page.locator('.agent-connection-row').filter({ hasText: name });
  await expect(page.locator('.agent-connection-row:visible')).toHaveCount(4);
  await expect(row('Expired reviewer')).toBeHidden();
  await expect(row('Disconnected reviewer')).toBeHidden();
  await expect(row('Combined reviewer')).toContainText('Private notes shared');
  await expect(row('History reviewer')).not.toContainText('Private notes shared');
  for (const color of ['light', 'dark']) {
    await theme(page, color);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      const access = row('Combined reviewer').getByRole('button', { name: 'Access details' });
      const height = () => access.evaluate((el) => el.getBoundingClientRect().height);
      if (width === 1440) await expect.poll(height).toBeLessThanOrEqual(40);
      else await expect.poll(height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        animations: 'disabled',
        path: `.runtime/browser/agent-connections-${info.project.name}-${width}-${color}.png`,
      });
    }
  }
  await row('Combined reviewer').getByRole('button', { name: 'Access details' }).click();
  await expect(row('Combined reviewer')).toContainText('2025-11-01 through 2026-11-30');
  await expect(row('Combined reviewer')).toContainText('weeks start Sunday');
  await expect(row('Combined reviewer')).toContainText('private notes excluded');
  await expect(row('Combined reviewer')).toContainText('Create races and goals: permitted');
  await row('History reviewer').getByRole('button', { name: 'Access details' }).click();
  await expect(row('History reviewer')).toContainText('Proposal submission is not permitted');
  await row('Legacy reviewer').getByRole('button', { name: 'Access details' }).click();
  await expect(row('Legacy reviewer')).toContainText('Create races and goals: not permitted');
  await page.locator('.agent-archive > summary').click();
  await expect(
    row('Disconnected reviewer').getByRole('button', { name: 'Disconnect', exact: true }),
  ).toHaveCount(0);
  await row('Expired reviewer').getByRole('button', { name: 'Access details' }).click();
  await expect(
    row('Expired reviewer').getByRole('button', { name: 'Revoke access' }),
  ).toBeVisible();
  await expect(row('Expired reviewer')).toContainText(
    'Revoking also prevents applying existing pending proposals',
  );
  await row('Expired reviewer').getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Revoke access for “Expired reviewer”?',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  grants.splice(0, grants.length, grants[1]!);
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: 'Proposals' })).toContainText(
    'Connect an agent with proposal access',
  );
});

test('revocation supports cancellation, preserves errors, then moves the grant to inactive', async ({
  page,
}) => {
  const state = { grants: [grant('Temporary reviewer')] };
  let requests = 0;
  await page.route('**/api/plugins/agent-bridge/revoke', async (route) => {
    requests++;
    if (requests === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Synthetic revocation failure' } },
      });
    state.grants = state.grants.map((item) => ({ ...item, revoked: true }));
    await route.fulfill({ json: { ok: true } });
  });
  await workspace(page, state);
  await page.getByRole('tab', { name: 'Connected agents' }).click();
  const row = page.locator('.agent-connection-row');
  await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'prevents applying any pending proposals',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toBe(0);
  await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect agent', exact: true }).click();
  await expect(row).toContainText('Synthetic revocation failure');
  await expect(row.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let startedRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    startedRefresh = resolve;
  });
  await page.route('**/api/workspace?*', async (route) => {
    startedRefresh();
    await refreshGate;
    await route.fallback();
  });
  await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect agent', exact: true }).click();
  await refreshStarted;
  try {
    await expect(page.locator('.agent-archive > summary')).toHaveCount(0);
    await expect(row).toBeVisible();
  } finally {
    releaseRefresh();
  }
  await expect(page.getByRole('heading', { name: 'No active connections' })).toBeInViewport();
  await expect(page.locator('.agent-archive > summary')).toBeFocused();
  await expect(row).toBeHidden();
  await page.locator('.agent-archive > summary').click();
  await expect(row).toContainText('Disconnected');
});

test('review keeps the full summary, retries details and lazily opens medium-sized proposals', async ({
  page,
}, info) => {
  const changes = Array.from({ length: 21 }, (_, index) => {
    const id = randomUUID();
    return {
      entity: 'plan',
      id,
      before: null,
      after: planSchema.parse({
        id,
        revision: 1,
        title: `Synthetic plan ${index + 1}`,
        startDate: '2026-11-16',
      }),
    };
  });
  const summary = 'A careful preparation block with easy running and gradual progress. '.repeat(8);
  const details = proposalDetailsSchema.parse({
    id: randomUUID(),
    digest: 'a'.repeat(64),
    summary,
    status: 'pending',
    warnings: [],
    createdAt: new Date().toISOString(),
    expiresAt,
    changes,
  });
  const proposal: ProposalSummary = {
    ...details,
    affectedCount: changes.length,
    dateBounds: { from: '2026-11-16', to: '2026-11-16' },
  };
  let failDetails = true;
  let reviewState = 'ready';
  await page.route('**/api/plugins/agent-bridge/details', (route) =>
    failDetails
      ? route.fulfill({
          status: 503,
          json: { error: { message: 'Synthetic details unavailable' } },
        })
      : route.fulfill({ json: details }),
  );
  await page.route('**/api/plugins/agent-bridge/review', (route) =>
    route.fulfill({
      json: {
        id: details.id,
        expiresAt,
        applicability: reviewState,
        currentContextDigest: null,
        contextChanges: [],
        conflicts:
          reviewState === 'ready'
            ? []
            : [
                {
                  code: 'synthetic_block',
                  message: `Synthetic ${reviewState} reason`,
                  status: 409,
                },
              ],
      },
    }),
  );
  await workspace(page, { grants: [], proposals: [proposal] });
  for (const color of ['light', 'dark']) {
    await theme(page, color);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeInViewport();
    await expect(page.locator('.agent-row-meta')).toContainText('16 Nov 2026');
    const height = await page
      .locator('.agent-summary-preview')
      .evaluate((e) => e.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(43);
    await page.screenshot({
      animations: 'disabled',
      path: `.runtime/browser/agent-proposals-${info.project.name}-${color}.png`,
    });
  }
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Synthetic details unavailable');
  await expect(dialog.getByText('Loading proposed edits…')).toHaveCount(0);
  failDetails = false;
  await dialog.getByRole('button', { name: 'Retry details' }).click();
  await expect(dialog.locator('.proposal-summary')).toHaveText(summary);
  await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
  await dialog.locator('.proposal-week-heading').click();
  await expect(dialog.locator('.proposal-diff')).toHaveCount(21);
  await dialog.locator('.proposal-week-heading').click();
  await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
  const apply = dialog.getByRole('button', { name: 'Apply all 21 changes', exact: true });
  await expect(apply).toBeDisabled();
  await dialog.getByRole('button', { name: 'Find changes' }).click();
  await dialog.getByLabel('Search changes').fill('Synthetic plan 1');
  await expect(dialog.locator('.proposal-diff')).toHaveCount(11);
  await dialog.locator('.proposal-week-heading').click();
  await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
  await dialog.getByLabel('Search changes').fill('Synthetic plan 2');
  await expect(dialog.locator('.proposal-diff')).toHaveCount(3);
  await dialog.getByLabel('Search changes').fill('No matching plan');
  await expect(dialog.locator('.proposal-no-results')).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear filters' }).click();
  await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
  await expect(dialog.locator('.proposal-week-heading')).toBeVisible();
  await dialog.getByLabel('Search changes').fill('Synthetic plan 1');
  await expect(dialog.locator('.proposal-diff')).toHaveCount(11);
  await expect(dialog.locator('.proposal-apply-scope')).toContainText(
    'including those hidden by filters',
  );
  await dialog.getByRole('checkbox').check();
  await expect(apply).toBeEnabled();
  for (const color of ['light', 'dark']) {
    await theme(page, color);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(apply).toBeInViewport();
      await expect(
        dialog.getByRole('button', { name: 'Close dialog', exact: true }),
      ).toBeInViewport();
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({
        animations: 'disabled',
        path: `.runtime/browser/agent-review-${info.project.name}-${width}-${color}.png`,
      });
    }
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeFocused();
  for (const state of ['expired', 'revoked', 'conflict', 'replacement-required', 'unavailable']) {
    reviewState = state;
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(dialog.locator('.proposal-review-state')).toContainText(
      `Synthetic ${state} reason`,
    );
    await expect(apply).toBeDisabled();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('history keeps its Sheet open through undo confirmation, failure and success', async ({
  page,
}) => {
  const entry: AuditSummary = {
    id: randomUUID(),
    title: 'Adjust the preparation week',
    summary: 'Synthetic complete batch',
    affectedCount: 4,
    createdAt: new Date().toISOString(),
    undoneAt: null,
    undoable: true,
  };
  const state = { grants: [], changes: [entry] };
  let calls = 0;
  await page.route('**/api/plugins/agent-bridge/undo', async (route) => {
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 409,
        json: { error: { message: 'Synthetic later edit prevents undo' } },
      });
    state.changes = [{ ...entry, undoneAt: new Date().toISOString() }];
    await route.fulfill({ json: { id: randomUUID(), changes: [] } });
  });
  await workspace(page, state);
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Change history' });
  await expect(sheet).toContainText(entry.title);
  const undo = sheet.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(undo).toBeFocused();
  expect(calls).toBe(0);
  await undo.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Undo change', exact: true })
    .click();
  await expect(sheet).toContainText('Synthetic later edit prevents undo');
  await expect(undo).toBeEnabled();
  await undo.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Undo change', exact: true })
    .click();
  await expect(sheet).toContainText('Undone');
  await expect(undo).toBeDisabled();
  await sheet.getByRole('button', { name: 'Close change history' }).click();
  await expect(page.getByRole('button', { name: 'Change history', exact: true })).toBeFocused();
});

test('long connection names and enlarged text reflow on a narrow phone', async ({ page }, info) => {
  await workspace(page, { grants: [grant('Synthetic reviewer with a long name '.repeat(3))] });
  await page.getByRole('tab', { name: 'Connected agents' }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Access details' }).click();
  await page.locator('.agent-workspace').evaluate((root) => {
    const targets = [...root.querySelectorAll('h1,h3,strong,p,button,summary')];
    const sizes = targets.map((e) => parseFloat(getComputedStyle(e).fontSize) * 2);
    targets.forEach((e, i) => {
      (e as HTMLElement).style.fontSize = `${sizes[i]}px`;
    });
  });
  for (const color of ['light', 'dark']) {
    await theme(page, color);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const control of await page.locator('.agent-workspace button:visible').all()) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await page.screenshot({
      path: `.runtime/browser/agent-text-scale-${info.project.name}-${color}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});
