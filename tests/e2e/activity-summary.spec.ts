import { test, expect, type Page } from '@playwright/test';
import { activitySchema, emptyWorkspace, profileSchema } from '@athlete-panel/contracts';
import { calendarId } from '../fixtures/calendar';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page, units: 'metric' | 'imperial') {
  const state = emptyWorkspace();
  state.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex (synthetic)',
    timezone: 'Europe/Paris',
    weekStartsOnPreference: 'monday',
    units,
  });
  state.activities = [
    [
      'Complete ride — endurance along the river with a steady climb home',
      'cycling',
      'road_biking',
      '2030-01-07',
      5400,
      42000,
    ],
    ['Unmeasured ride', 'cycling', 'mountain_biking', '2030-01-08', null, null],
    ['Trail run', 'running', 'trail_running', '2030-01-09', 1200, null],
    ['Zero run', 'running', 'street_running', '2030-01-10', 0, 0],
    ['Earlier ride', 'cycling', 'road_biking', '2030-01-06', 3600, 30000],
    ['Later ride', 'cycling', 'road_biking', '2030-01-28', 900, 3000],
  ].map(([title, sport, sportSubgroup, localDate, durationSeconds, distanceMeters], index) =>
    activitySchema.parse({
      id: calendarId(7500 + index),
      revision: 1,
      provider: 'garmin',
      externalId: `synthetic-coverage-${index}`,
      title,
      sport,
      sportSubgroup,
      sportResolution: 'resolved',
      startedAt: `${localDate}T09:00:00Z`,
      localDate,
      dateSource: 'provider',
      durationSeconds,
      distanceMeters,
      elevationMeters: null,
      averageHeartRateBpm: null,
    }),
  );
  await page.clock.setFixedTime(new Date('2030-01-09T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let mutations = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) mutations++;
  });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar' })).toBeVisible();
  await page.getByLabel('Go to date').fill('2030-01-07');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  const link = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Activities', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible();
  return () => mutations;
}

async function checkResponsiveRows(page: Page, measuredDistance: string) {
  const measuredRow = page.getByRole('row').filter({ hasText: 'Complete ride' });
  await expect(measuredRow.getByText('1h 30m', { exact: true })).toBeVisible();
  await expect(measuredRow.getByText(measuredDistance, { exact: true })).toBeVisible();
  const unknownRow = page.getByRole('row').filter({ hasText: 'Unmeasured ride' });
  await expect(unknownRow.getByText('Not recorded', { exact: true })).toHaveCount(2);
  // The list itself must not hide measurements or actions in an inner horizontal scroller.
  expect(
    await page
      .locator('.activity-table')
      .evaluate((table) => table.scrollWidth <= table.clientWidth),
  ).toBe(true);
  const view = unknownRow.getByRole('button', { name: 'View Unmeasured ride', exact: true });
  await view.scrollIntoViewIfNeeded();
  const bounds = await view.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await view.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Unmeasured ride', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(view).toBeFocused();
}

for (const theme of ['dark', 'light'] as const) {
  for (const units of ['metric', 'imperial'] as const) {
    test(`activity totals disclose coverage in ${theme} and ${units}`, async ({ page }, info) => {
      const mutations = await preview(page, units);
      if (theme === 'light')
        await page
          .getByRole('button', {
            name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
            exact: true,
          })
          .click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const summary = page.getByRole('region', { name: 'Activity summary', exact: true });
      const stat = (label: string) =>
        summary.locator('.stat').filter({ has: page.getByText(label, { exact: true }) });
      const time = stat('Recorded time');
      const distance = stat('Recorded distance');
      const sessions = stat('Imported sessions');
      const sport = page.getByLabel('Filter activities by sport');
      const search = page.getByRole('textbox', { name: 'Search activities' });
      const measuredDistance = units === 'metric' ? '42.0 km' : '26.1 mi';

      await expect(sessions.locator('strong')).toHaveText('4');
      await expect(time.locator('strong')).toHaveText('1h 50m');
      await expect(time).toContainText('Partial · 1 activity missing duration');
      await expect(distance.locator('strong')).toHaveText(measuredDistance);
      await expect(distance).toContainText('Partial · 2 activities missing distance');

      await search.fill('RIDE');
      await expect(sessions.locator('strong')).toHaveText('2');
      await expect(time.locator('strong')).toHaveText('1h 30m');
      await expect(time).toContainText('Partial · 1 activity missing duration');
      await expect(distance.locator('strong')).toHaveText(measuredDistance);
      await expect(distance).toContainText('Partial · 1 activity missing distance');
      await search.fill('');
      await sport.selectOption('cycling');
      await expect(sessions.locator('strong')).toHaveText('2');
      await page.getByLabel('Filter activities by subgroup').selectOption('mountain_biking');
      await expect(sessions.locator('strong')).toHaveText('1');
      await expect(time.locator('strong')).toHaveText('—');
      await expect(time).toContainText('1 activity missing duration');
      await expect(distance.locator('strong')).toHaveText('—');
      await expect(distance).toContainText('1 activity missing distance');
      await expect(summary).not.toContainText('Partial');

      await page.getByLabel('Filter activities by subgroup').selectOption('road_biking');
      await expect(time.locator('strong')).toHaveText('1h 30m');
      await expect(time).toContainText('1 activity recorded');
      await expect(distance.locator('strong')).toHaveText(measuredDistance);
      await expect(distance).toContainText('1 activity recorded');

      await sport.selectOption('running');
      await expect(sessions.locator('strong')).toHaveText('2');
      await expect(time.locator('strong')).toHaveText('20m');
      await expect(time).toContainText('All 2 activities recorded');
      await expect(distance.locator('strong')).toHaveText(units === 'metric' ? '0.0 km' : '0.0 mi');
      await expect(distance).toContainText('Partial · 1 activity missing distance');
      await search.fill('Zero');
      await expect(time.locator('strong')).toHaveText('0m');
      await expect(time).toContainText('1 activity recorded');
      await expect(distance.locator('strong')).toHaveText(units === 'metric' ? '0.0 km' : '0.0 mi');
      await expect(distance).toContainText('1 activity recorded');

      await search.fill('No such activity');
      await expect(sessions.locator('strong')).toHaveText('0');
      await expect(sessions).toContainText('No activities in this selection');
      await expect(time.locator('strong')).toHaveText('—');
      await expect(distance.locator('strong')).toHaveText('—');
      await expect(summary).not.toContainText('missing');
      await expect(page.getByRole('heading', { name: 'No matching activities' })).toBeVisible();

      await page.getByRole('button', { name: 'Clear filters', exact: true }).last().click();
      await expect(search).toHaveValue('');
      await expect(sport).toHaveValue('all');
      await expect(sessions.locator('strong')).toHaveText('4');
      await page.getByLabel('Go to date').fill('2030-01-28');
      await expect(sessions.locator('strong')).toHaveText('1');
      await expect(time.locator('strong')).toHaveText('15m');
      await expect(time).toContainText('1 activity recorded');
      await expect(distance.locator('strong')).toHaveText(units === 'metric' ? '3.0 km' : '1.9 mi');
      await expect(summary).not.toContainText('Partial');
      await page.getByLabel('Go to date').fill('2030-01-07');
      await expect(distance).toContainText('Partial · 2 activities missing distance');
      await page.setViewportSize({
        width: info.project.name === 'mobile' ? 320 : 900,
        height: 900,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(time.locator('.stat-hint')).toBeVisible();
      await expect(distance.locator('.stat-hint')).toBeVisible();
      await checkResponsiveRows(page, measuredDistance);
      expect(mutations()).toBe(0);
    });
  }
}
