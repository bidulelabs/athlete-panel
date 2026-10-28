import { test, expect, type Page } from '@playwright/test';
import { weeklyFixture } from '../fixtures/weekly';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page) {
  const data = weeklyFixture();
  let mutations = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) mutations++;
  });
  await page.clock.setFixedTime(new Date('2030-01-09T12:00:00Z'));
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    await route.fulfill({ response, json: { ...envelope, state: data } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.getByLabel('Go to date').fill('2030-01-07');
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', '2030-01-07');
  return { data, mutations: () => mutations };
}
const row = (week: ReturnType<Page['locator']>, name: string) =>
  week.getByRole('row').filter({ has: week.page().getByRole('rowheader', { name, exact: true }) });
async function refresh(page: Page) {
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

test('each week expands independently with accurate volume, elevation, sleep and keyboard controls', async ({
  page,
}, info) => {
  const { mutations } = await preview(page);
  const week = page.locator('.calendar-week').first();
  const toggle = week.getByRole('button', { name: /^Expand summary/ });
  await expect(page.locator('.week-summary-toggle')).toHaveCount(3);
  await expect(page.locator('.week-summary-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(week.locator('.week-header-metric')).toHaveCount(5);
  await expect(week.locator('.week-summary-header')).toContainText('5h');
  await expect(week.locator('.week-summary-header')).toContainText('4h');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(week.locator('.week-summary-body')).toBeVisible();
  await expect(week.locator('.week-band-metric')).toHaveCount(8);
  await expect(
    week.getByRole('table', { name: 'Planned and recorded training' }),
  ).not.toBeVisible();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(row(week, 'Training duration').getByRole('cell').nth(0)).toContainText('4h');
  await expect(row(week, 'Training duration').getByRole('cell').nth(1)).toContainText('5h');
  await expect(row(week, 'Training duration')).toContainText('80% of planned volume');
  await expect(row(week, 'Running distance')).toContainText('20.0 km');
  await expect(row(week, 'Running distance')).toContainText('15.0 km');
  await expect(row(week, 'Running distance')).toContainText('75% of planned volume');
  await expect(row(week, 'Cycling distance')).toContainText('90.0 km');
  await expect(row(week, 'Cycling distance')).toContainText('50.0 km');
  await expect(week.getByRole('region', { name: 'Recorded elevation gain' })).toContainText(
    '100 m',
  );
  await expect(week.getByRole('region', { name: 'Recorded elevation gain' })).toContainText(
    'Elevation missing for 1 of 2 sessions',
  );
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText('7h');
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText(
    '2 of 3 nights recorded · 1 unavailable',
  );
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText(
    '4 upcoming nights',
  );
  const second = page.locator('.calendar-week').nth(1);
  await second.getByRole('button', { name: /^Expand summary/ }).click();
  await second.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(second.getByRole('region', { name: 'Recorded sleep' })).toContainText('Upcoming');
  await expect(row(second, 'Training duration')).toContainText('No sessions recorded');
  await expect(week.locator('.week-summary-toggle')).toHaveAttribute('aria-expanded', 'true');
  await second.getByRole('button', { name: /^Collapse summary/ }).click();
  await week.scrollIntoViewIfNeeded();
  await week.screenshot({
    path: `.runtime/browser/weekly-summary-${info.project.name}-dark.png`,
    animations: 'disabled',
  });
  await page
    .getByRole('button', {
      name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
      exact: true,
    })
    .click();
  await week.screenshot({
    path: `.runtime/browser/weekly-summary-${info.project.name}-light.png`,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const collapse = week.getByRole('button', { name: /^Collapse summary/ });
  await collapse.focus();
  await page.keyboard.press('Space');
  await expect(week.locator('.week-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(mutations()).toBe(0);
});

test('partial totals suppress comparisons, zero stays known, and unit/week changes preserve records', async ({
  page,
}) => {
  const { data, mutations } = await preview(page);
  const week = page.locator('.calendar-week').first();
  await week.getByRole('button', { name: /^Expand summary/ }).click();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  data.activities[0]!.durationSeconds = null;
  data.activities[1]!.distanceMeters = null;
  data.activities[0]!.elevationMeters = 0;
  await refresh(page);
  await expect(row(week, 'Training duration')).toContainText(
    'Partial · Duration missing for 1 of 4 sessions',
  );
  await expect(row(week, 'Training duration')).toContainText(
    'Comparison unavailable · incomplete data',
  );
  await expect(row(week, 'Training duration')).not.toContainText('%');
  await expect(row(week, 'Running distance')).toContainText('5.0 km');
  await expect(row(week, 'Running distance')).not.toContainText('%');
  await expect(week.getByRole('region', { name: 'Recorded elevation gain' })).toContainText('0 m');
  for (const workout of data.workouts) if (workout.sport === 'cycling') workout.distanceMeters = 0;
  await refresh(page);
  await expect(week.getByRole('button', { name: /^Cycling distance:/ })).toContainText(
    '50.0 km / 0.0 km',
  );
  await expect(
    week.locator('.week-band-metric').filter({ hasText: 'Cycling distance' }),
  ).toContainText('Planned: 0.0 km');
  data.profile!.units = 'imperial';
  await refresh(page);
  await expect(row(week, 'Cycling distance')).toContainText('31.1 mi');
  await expect(week.getByRole('region', { name: 'Recorded elevation gain' })).toContainText(
    '328 ft',
  );
  const before = JSON.stringify(data.workouts);
  data.profile!.weekStartsOnPreference = 'sunday';
  await refresh(page);
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', '2030-01-06');
  await expect(week.locator('.week-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
  await week.getByRole('button', { name: /^Expand summary/ }).click();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText(
    '2 of 4 nights recorded · 2 unavailable',
  );
  expect(JSON.stringify(data.workouts)).toBe(before);
  expect(mutations()).toBe(0);
});

test('unavailable data, zero plans and refresh failures do not invent complete totals', async ({
  page,
}) => {
  const { data, mutations } = await preview(page);
  data.workouts = [];
  data.health = [];
  for (const activity of data.activities) {
    activity.durationSeconds = null;
    activity.distanceMeters = null;
    activity.elevationMeters = null;
  }
  await refresh(page);
  const week = page.locator('.calendar-week').first();
  await week.getByRole('button', { name: /^Expand summary/ }).click();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(row(week, 'Training duration')).toContainText('Duration unavailable');
  await expect(row(week, 'Training duration')).toContainText('No planned volume');
  await expect(row(week, 'Training duration')).not.toContainText('%');
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText(
    'Sleep duration unavailable',
  );
  await expect(week.getByRole('region', { name: 'Recorded sleep' })).toContainText(
    '0 of 3 nights recorded',
  );
  await page.route(
    '**/api/workspace?**',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Synthetic refresh failure' }),
      }),
    { times: 1 },
  );
  await refresh(page);
  await expect(page.locator('.page-error')).toContainText('Synthetic refresh failure');
  await expect(row(week, 'Training duration')).toContainText('Duration unavailable');
  data.activities[0]!.durationSeconds = 3600;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.page-error')).toHaveCount(0);
  await expect(row(week, 'Training duration')).toContainText('1h');
  await expect(row(week, 'Training duration')).toContainText('Partial');
  expect(mutations()).toBe(0);
});

test('compact headers expose key metrics and open existing session details without writing', async ({
  page,
}, info) => {
  const { mutations } = await preview(page);
  const week = page.locator('.calendar-week').first(),
    toggle = week.locator('.week-summary-toggle');
  await expect(week.locator('.week-summary-header')).toContainText('This week');
  await expect(week.locator('.week-summary-header')).toContainText('15.0 km / 20.0 km');
  await expect(week.locator('.week-summary-header')).toContainText('50.0 km / 90.0 km');
  await expect(week.locator('.week-summary-header')).toContainText('7h');
  await expect(page.locator('.week-current-label')).toHaveCount(1);
  await expect(week.getByRole('button', { name: /^View recorded session/ })).toHaveCount(0);
  await toggle.screenshot({
    path: `.runtime/browser/week-header-${info.project.name}-dark.png`,
    animations: 'disabled',
  });
  await toggle.click();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  const status = week.getByRole('region', { name: 'Planned-session status' });
  for (const name of ['Completed', 'Partial', 'Skipped', 'Pending'])
    await expect(status.locator('dl > div').filter({ hasText: name })).toContainText('1');
  await expect(week.getByRole('region', { name: 'Recorded HRV' })).toContainText('54 ms');
  await expect(week.getByRole('region', { name: 'Recorded HRV' })).toContainText(
    '1 of 3 nights recorded · 2 unavailable',
  );
  const sessions = week.getByRole('region', { name: 'Recorded sessions' });
  await expect(sessions.getByRole('button')).toHaveCount(4);
  await sessions
    .getByRole('button', { name: 'View recorded session Morning ride', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Morning ride' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Steady endurance ride');
  await page.keyboard.press('Escape');
  await expect(
    sessions.getByRole('button', { name: 'View recorded session Morning ride', exact: true }),
  ).toBeFocused();
  await sessions
    .getByRole('button', { name: 'View recorded session Short easy run', exact: true })
    .click();
  await expect(page.getByRole('complementary', { name: 'Workout details' })).toContainText(
    'Short easy run',
  );
  await expect(week.locator('.week-summary-header')).toContainText('15.0 km / 20.0 km');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.name === 'desktop') {
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: '.runtime/browser/week-header-inspector-dark.png',
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Close workout details' }).click();
  await toggle.click();
  await expect(week.getByRole('button', { name: /^View recorded session/ })).toHaveCount(0);
  await page
    .getByRole('button', {
      name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
      exact: true,
    })
    .click();
  await toggle.screenshot({
    path: `.runtime/browser/week-header-${info.project.name}-light.png`,
    animations: 'disabled',
  });
  expect(mutations()).toBe(0);
});

test('preview is chronological and bounded, empty states stay explicit, and reduced motion is respected', async ({
  page,
}) => {
  const { data, mutations } = await preview(page);
  for (let i = 0; i < 4; i++)
    data.activities.push({
      ...data.activities[0]!,
      id: `10000000-0000-4000-8000-000000000${910 + i}`,
      externalId: `preview-extra-${i}`,
      title: `Extra ride ${i}`,
      localDate: '2030-01-10',
      startedAt: `2030-01-10T0${i}:00:00Z`,
    });
  await refresh(page);
  const week = page.locator('.calendar-week').first();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await week.locator('.week-summary-toggle').click();
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  const sessions = week.getByRole('region', { name: 'Recorded sessions' });
  await expect(sessions.getByRole('button')).toHaveCount(6);
  await expect(sessions.getByRole('button').first()).toHaveAccessibleName(
    'View recorded session Morning ride',
  );
  await expect(sessions).toContainText('+2 more sessions');
  expect(
    await week
      .locator('.week-summary-body')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
  data.activities = [];
  data.workouts = [];
  data.health = [];
  await refresh(page);
  await expect(sessions).toContainText('No sessions recorded');
  await expect(week.getByRole('region', { name: 'Recorded HRV' })).toContainText('HRV unavailable');
  await expect(week.locator('.week-header-metric').first()).toContainText('— / No plan');
  expect(mutations()).toBe(0);
});

test('metric explanations support hover, focus and touch without toggling or writing', async ({
  page,
}, info) => {
  const { mutations } = await preview(page);
  const week = page.locator('.calendar-week').first();
  const metric = week.getByRole('button', { name: /^Running distance:/ });
  if (info.project.name === 'desktop') {
    await metric.hover();
    await expect(page.getByRole('tooltip')).toContainText('Recorded / planned, kilometres');
    await page.mouse.move(0, 0);
    await metric.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).not.toBeVisible();
  }
  if (info.project.name === 'mobile') await metric.tap();
  else await metric.click();
  const explanation = page.getByRole('dialog', { name: 'Running distance information' });
  await expect(explanation).toContainText('Recorded / planned, kilometres');
  await expect(week.locator('.week-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(explanation).not.toBeVisible();
  await expect(metric).toBeFocused();
  await metric.click();
  await page.getByRole('heading', { name: 'Training calendar', exact: true }).click();
  await expect(explanation).not.toBeVisible();
  await week.locator('.week-summary-toggle').click();
  await expect(week.getByRole('button', { name: 'Show details', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await week.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(week.getByRole('table', { name: 'Planned and recorded training' })).toBeVisible();
  await week.locator('.week-summary-toggle').click();
  await week.locator('.week-summary-toggle').click();
  await expect(week.getByRole('button', { name: 'Show details', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(
    week.getByRole('table', { name: 'Planned and recorded training' }),
  ).not.toBeVisible();
  expect(mutations()).toBe(0);
});

test('week summaries fit the full width/theme matrix, long imperial values and year boundaries', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'mobile',
    'The matrix sets its own viewports. Touch interaction is covered separately.',
  );
  const { data, mutations } = await preview(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.locator('.week-summary-toggle').first().click();
  await page.locator('.calendar-week').first().screenshot({
    path: '.runtime/shadcn-review/summary-preview-light.png',
    animations: 'disabled',
  });
  await page.locator('.week-summary-toggle').first().click();
  data.profile!.units = 'imperial';
  data.activities[0]!.distanceMeters = 123456789;
  data.activities[0]!.elevationMeters = 123456;
  await refresh(page);
  const week = page.locator('.calendar-week').first();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [320, 390, 768, 1060, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(week.locator('.week-header-metric')).toHaveCount(5);
      for (const metric of await week.locator('.week-header-metric').all()) {
        expect(await metric.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        expect((await metric.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440)
        expect(
          (await week.locator('.week-summary-header').boundingBox())!.height,
        ).toBeLessThanOrEqual(48);
      await week.locator('.week-summary-toggle').click();
      await week.screenshot({
        path: `.runtime/shadcn-review/week-${theme}-${width}.png`,
        animations: 'disabled',
      });
      await week.locator('.week-summary-toggle').click();
      await page.getByRole('button', { name: 'Open Pending ride', exact: true }).click();
      await expect(page.getByRole('complementary', { name: 'Workout details' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/shadcn-review/inspector-${theme}-${width}.png`,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Close workout details', exact: true }).click();
    }
  }
  await page.getByLabel('Go to date').fill('2030-12-30');
  await expect(week.locator('.week-summary-date')).toContainText('30 Dec 2030 – 5 Jan 2031');
  expect(mutations()).toBe(0);
});
