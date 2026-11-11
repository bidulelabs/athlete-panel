import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { AuditSummary } from '@athlete-panel/contracts';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

for (const view of [
  {
    path: '/agent',
    title: 'Change history',
    description: 'Recent changes across your training.',
    width: 560,
    plugin: 'agent-bridge',
  },
  {
    path: '/plans',
    title: 'Recent changes',
    description: 'Review recent edits across your training.',
    width: 500,
    plugin: 'training',
  },
]) {
  test(`${view.title} preserves its description, dismissal and confirmation behavior`, async ({
    page,
  }, info) => {
    const changes: AuditSummary[] = Array.from({ length: 50 }, (_, index) => ({
      id: randomUUID(),
      title: `Synthetic history entry ${index + 1}`,
      summary: 'Synthetic history review',
      affectedCount: 1,
      createdAt: new Date().toISOString(),
      undoneAt: null,
      undoable: true,
    }));
    await page.route('**/api/workspace?*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), changes } });
    });
    let undoRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/undo')) undoRequests++;
    });
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    await page.goto(view.path);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const trigger = page.getByRole('button', { name: view.title, exact: true });
    const sheet = page.getByRole('dialog', { name: view.title, exact: true, includeHidden: true });
    const confirmation = page.getByRole('alertdialog');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await trigger.click();
        await expect(sheet.locator('[data-slot="sheet-description"]')).toHaveText(view.description);
        const close = sheet.getByRole('button', { name: `Close ${view.title.toLowerCase()}` });
        await expect(close).toBeFocused();
        expect((await sheet.boundingBox())!.width).toBe(width === 1440 ? view.width : width);
        expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        const undo = sheet.getByRole('button', { name: 'Undo', exact: true }).first();
        await undo.click();
        await expect(confirmation).toBeVisible();
        // The confirmation backdrop covers the still-open Sheet's header.
        await page.mouse.click(width - 8, 8);
        await expect(confirmation).toBeVisible();
        await expect(sheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(confirmation).toHaveCount(0);
        await expect(sheet).toBeVisible();
        await expect(undo).toBeFocused();
        await page.screenshot({
          path: `.runtime/browser/shared-history-${view.path.slice(1)}-${info.project.name}-${width}-${theme}.png`,
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await trigger.click();
    await expect(
      sheet.getByRole('button', { name: `Close ${view.title.toLowerCase()}` }),
    ).toBeFocused();
    await page.mouse.click(8, 100);
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
    changes.pop();
    await page.reload();
    await trigger.click();
    await expect(sheet.locator('[data-slot="sheet-description"]')).toHaveText(view.description);
    expect(undoRequests).toBe(0);
    await page.keyboard.press('Escape');
    let failedUndoRequests = 0;
    await page.route(`**/api/plugins/${view.plugin}/undo`, async (route) => {
      failedUndoRequests++;
      expect(route.request().postDataJSON().id).toBe(changes[39]!.id);
      await route.fulfill({
        status: 409,
        json: { error: { message: 'Synthetic later edit prevents undo' } },
      });
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await trigger.click();
        await expect(sheet.getByRole('alert')).toHaveCount(0);
        const undo = sheet.getByRole('button', { name: 'Undo', exact: true }).nth(39);
        await undo.click();
        await confirmation.getByRole('button', { name: 'Undo change', exact: true }).click();
        const error = sheet.getByRole('alert');
        await expect(error).toContainText('Synthetic later edit prevents undo');
        await expect(error).toBeInViewport();
        await expect(
          sheet.getByRole('button', { name: `Close ${view.title.toLowerCase()}` }),
        ).toBeInViewport();
        expect(
          await sheet.locator('.history-sheet-scroll').evaluate((el) => el.scrollTop),
        ).toBeGreaterThan(1000);
        await expect(undo).toBeEnabled();
        await page.screenshot({
          path: `.runtime/browser/history-error-${view.path.slice(1)}-${info.project.name}-${width}-${theme}.png`,
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
      }
    }
    expect(failedUndoRequests).toBe(6);
    changes.splice(0);
    await page.reload();
    await trigger.click();
    await expect(sheet.locator('[data-slot="sheet-description"]')).toHaveText(view.description);
    await expect(sheet).toContainText('No changes yet');
  });
}
