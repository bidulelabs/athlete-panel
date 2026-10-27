import { test, expect } from '@playwright/test';

test('Athlete Panel identity fits login and navigation and keeps the existing theme', async ({
  page,
  context,
}, info) => {
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');
  await page.addInitScript(() => {
    localStorage.setItem('athlete-panel-theme', 'light');
  });
  await page.goto('/login');
  await expect(page).toHaveTitle('Athlete Panel · Your training workspace');
  await expect(page.locator('.brand')).toContainText('Athlete Panel');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.name === 'athlete_panel_session' && cookie.httpOnly,
    ),
  ).toBe(true);
  const opener = page.getByRole('button', { name: 'Open navigation' });
  if (await opener.isVisible()) await opener.click();
  const brand = page.locator('.sidebar .brand, .navigation-sheet .brand');
  await expect(brand).toHaveText('Athlete Panel.');
  expect(await brand.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(brand).toBeInViewport();
  await page.screenshot({
    path: `.runtime/product-identity/brand-${info.project.name}.png`,
    animations: 'disabled',
  });
});
