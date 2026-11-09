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
    const goalTitle = `Goal ${suffix}`;
    const noteTitle = `Note ${suffix}`;
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
            { action: 'event.create', values: { title: goalTitle, date, kind: 'goal' } },
            {
              action: 'note.create',
              values: {
                title: noteTitle,
                body: 'Bring water and enjoy the day.',
                schedule: { kind: 'independent', date },
              },
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
      if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
      const trigger = page
        .locator('.proposal-row')
        .filter({ hasText: summary })
        .getByRole('button', { name: 'Review', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Review proposed changes' });
      await expect(
        dialog.getByRole('heading', { name: 'Proposed edits', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');
      await expect(dialog.locator('.proposal-summary')).toHaveText(summary);
      await expect(dialog.locator('.proposal-summary')).toBeInViewport();
      const edits = dialog.getByRole('region', { name: 'Proposed edits', exact: true });
      for (const kind of ['workout', 'race', 'goal', 'note']) {
        await expect(edits.locator(`.proposal-type-${kind}`).first()).toBeVisible();
        await expect(edits.locator(`.proposal-type-${kind} svg`).first()).toBeVisible();
      }
      const colors = await edits
        .locator('.proposal-type')
        .evaluateAll((els) =>
          Object.fromEntries(els.map((el) => [el.textContent, getComputedStyle(el).color])),
        );
      expect(new Set([colors.Workout, colors.Race, colors.Goal, colors.Note]).size).toBe(4);
      await page.screenshot({
        path: `.runtime/browser/proposal-types-${info.project.name}-${theme}.png`,
        animations: 'disabled',
      });
      await dialog
        .locator('.proposal-review-body')
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.screenshot({
        path: `.runtime/browser/proposal-types-scrolled-${info.project.name}-${theme}.png`,
        animations: 'disabled',
      });
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
      await expect(eventRow.getByRole('columnheader', { name: 'Before', exact: true })).toHaveCount(
        0,
      );
      await dialog
        .locator('.proposal-review-body')
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      const [closeBox, applyBox] = await Promise.all([
        dialog.getByRole('button', { name: 'Close dialog', exact: true }).boundingBox(),
        dialog.getByRole('button', { name: 'Apply reviewed changes' }).boundingBox(),
      ]);
      expect(closeBox!.y).toBeGreaterThanOrEqual(0);
      expect(applyBox!.y + applyBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await edits.getByText('Find changes', { exact: true }).click();
      await edits.getByLabel('Search changes').fill('No matching synthetic item');
      await expect(edits.getByText(/No changes match these filters/)).toBeVisible();
      await edits.getByRole('button', { name: 'Clear filters' }).click();
      const displayedDate = await eventRow.locator('.proposal-diff-facts').innerText();
      for (const query of [date, displayedDate]) {
        await edits.getByLabel('Search changes').fill(query);
        await expect(edits.locator('.proposal-diff')).toHaveCount(5);
      }
      await edits.getByRole('button', { name: 'Clear filters' }).click();
      await edits.getByLabel('Item type').selectOption('race');
      await expect(edits.locator('.proposal-diff')).toHaveCount(1);
      await expect(edits.getByRole('status')).toContainText('Apply includes all');
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
      const receipt = page.getByRole('region', { name: 'Proposal result' });
      await expect(receipt).toContainText('Proposal applied');
      await expect(receipt).toContainText('1 goal');
      await expect(receipt).toContainText('1 note');
      const calendar = await page.context().newPage();
      await calendar.goto('/calendar');
      const raceCard = calendar.getByRole('button', { name: `Open event ${title}`, exact: true });
      const goalCard = calendar.getByRole('button', {
        name: `Open event ${goalTitle}`,
        exact: true,
      });
      const noteCard = calendar.getByRole('button', {
        name: `Open note ${noteTitle}`,
        exact: true,
      });
      await expect(raceCard).toBeVisible();
      await expect(goalCard).toBeVisible();
      await expect(noteCard).toBeVisible();
      await expect(
        calendar.getByRole('button', { name: `Open Warm-up ${suffix}`, exact: true }),
      ).toBeVisible();
      expect(
        await raceCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--fact-color')),
      ).not.toBe(
        await goalCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--fact-color')),
      );
      await expect(goalCard.locator('svg')).toHaveClass(/lucide-target/);
      await raceCard.click();
      await expect(calendar.getByRole('dialog')).toContainText('Synthetic target notes');
      await calendar.screenshot({
        path: `.runtime/browser/agent-event-calendar-${info.project.name}-${theme}.png`,
        animations: 'disabled',
      });
      await calendar.close();
      // Undo the entire proposal from its receipt, then check every created type is gone.
      await receipt.getByRole('button', { name: 'Undo proposal', exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Confirm', exact: true })
        .click();
      await expect(receipt).toContainText('Proposal undone');
      undone = true;
      await receipt.getByRole('button', { name: 'View calendar', exact: true }).click();
      await expect(
        page.getByRole('button', { name: `Open event ${goalTitle}`, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `Open note ${noteTitle}`, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `Open event ${title}`, exact: true }),
      ).toHaveCount(0);
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
