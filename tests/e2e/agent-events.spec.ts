import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');

for (const theme of ['light', 'dark']) {
  test(`review, apply, inspect and undo a race with its training plan in ${theme}`, async ({
    page,
    request,
    baseURL,
  }, info) => {
    await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    const date = await page.evaluate(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()),
    );
    const owner = (operation: string, data: unknown) =>
      page.request.post(`/api/plugins/agent-bridge/${operation}`, {
        headers: { Origin: baseURL! },
        data,
      });
    const access = await owner('grant', {
      label: 'Synthetic race proposal',
      version: 2,
      history: null,
      planning: { from: date, to: date, allowEventCreation: true, includeNotes: true },
    });
    expect(access.ok()).toBe(true);
    const { token, grant } = await access.json();
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = randomUUID().slice(0, 8);
    const title = `Race ${info.project.name} ${theme} ${suffix}`;
    const summary = `Add ${title} and preparation`;
    const planId = randomUUID();
    let proposalId: string | undefined;
    let auditId: string | undefined;
    let undone = false;
    try {
      const context = await (await request.get('/api/agent/context', { headers })).json();
      const proposed = await request.post('/api/agent/propose', {
        headers,
        data: {
          summary,
          contextDigest: context.contextDigest,
          idempotencyKey: randomUUID(),
          commands: [
            {
              action: 'event.create',
              values: { title, date, kind: 'race', notes: 'Synthetic target notes' },
            },
            {
              action: 'plan.create',
              values: { id: planId, title: `Preparation ${suffix}`, startDate: date },
            },
            {
              action: 'workout.create',
              values: {
                title: `Warm-up ${suffix}`,
                sport: 'running',
                schedule: { kind: 'plan', planId, day: 1 },
                durationSeconds: 600,
              },
            },
          ],
        },
      });
      expect(proposed.ok(), await proposed.text()).toBe(true);
      proposalId = (await proposed.json()).id;
      const unchanged = await (await request.get('/api/agent/context', { headers })).json();
      expect(unchanged.context.events.some((e: { title: string }) => e.title === title)).toBe(
        false,
      );
      await page.goto('/agent');
      await page
        .locator('.proposal-row')
        .filter({ hasText: summary })
        .getByRole('button', { name: 'Review', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Review proposed changes' });
      const eventRow = dialog.locator('.proposal-diff').filter({ hasText: title });
      await expect(eventRow.locator('summary')).toContainText('Create');
      await expect(eventRow.locator('summary')).toContainText('Race');
      await expect(eventRow.locator('summary')).toContainText(
        new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
          new Date(`${date}T12:00:00Z`),
        ),
      );
      await eventRow.locator('summary').first().click();
      await expect(eventRow).toContainText(date);
      await expect(eventRow).toContainText('Synthetic target notes');
      await expect(dialog.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
      await dialog.getByRole('checkbox').check();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/browser/agent-event-review-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      const appliedResponse = page.waitForResponse((r) => r.url().endsWith('/agent-bridge/apply'));
      await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
      const applied = await appliedResponse;
      expect(applied.ok(), await applied.text()).toBe(true);
      auditId = (await applied.json()).id;
      await expect(dialog).not.toBeVisible();
      await page.goto('/calendar');
      const card = page.getByRole('button', { name: `Open event ${title}`, exact: true });
      await expect(card).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Open Warm-up ${suffix}`, exact: true }),
      ).toBeVisible();
      await card.click();
      await expect(page.getByRole('dialog')).toContainText('Synthetic target notes');
      await page.screenshot({
        path: `.runtime/browser/agent-event-calendar-${info.project.name}-${theme}.png`,
        fullPage: false,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await page.goto('/agent');
      await page.getByRole('tab', { name: 'Change history' }).click();
      const row = page
        .locator('.proposal-row')
        .filter({ has: page.getByText(summary, { exact: true }) });
      await row.getByRole('button', { name: 'Undo', exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(row).toContainText('Undone');
      undone = true;
      await page.goto('/calendar');
      await expect(card).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `Open Warm-up ${suffix}`, exact: true }),
      ).toHaveCount(0);
    } finally {
      if (auditId && !undone) await owner('undo', { id: auditId, idempotencyKey: randomUUID() });
      if (proposalId && !auditId) await owner('reject', { id: proposalId });
      await owner('revoke', { id: grant.id });
    }
  });
}
