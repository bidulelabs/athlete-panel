import { test, expect } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

test('shared controls and all app pages retain usable themes, navigation and keyboard dialogs', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('data-slot', 'input');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: `.runtime/shadcn-review/login-${theme}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  if (info.project.name === 'desktop')
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light']) {
    for (const path of [
      '/calendar',
      '/plans',
      '/activities',
      '/health',
      '/settings',
      '/garmin',
      '/agent',
      '/plugins',
      '/cycling-sleep',
    ]) {
      await page.goto(path);
      await expect(page.locator('.page-content')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/shadcn-review/screen-${path.slice(1)}-${theme}-${info.project.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.goto('/settings');
  const tabs = page.getByRole('tablist', { name: 'Athlete settings' });
  expect((await tabs.boundingBox())!.y).toBeLessThan(
    (await page.getByRole('heading', { name: 'Athlete profile', exact: true }).boundingBox())!.y,
  );
  await tabs.getByRole('tab', { name: 'Profile & zones' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/calendar');
  const trigger = page.locator('.calendar-workout').first();
  await trigger.click();
  await page.getByRole('button', { name: 'Delete workout', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm change' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete workout', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Workout details' })).not.toBeVisible();
  await expect(trigger).toBeFocused();
  if (info.project.name === 'mobile') {
    const opener = page.getByRole('button', { name: 'Open navigation' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }
  expect(errors).toEqual([]);
});
