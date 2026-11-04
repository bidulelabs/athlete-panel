import { test, expect, type Page } from '@playwright/test';
import { chartsSummaryInputSchema, emptyWorkspace } from '@athlete-panel/contracts';
import { chartsSummary } from '../../plugins/charts/summary';
import {
  chartsWorkspace,
  elevationAndHeartRateWorkspace,
  mixedSportsWorkspace,
  nightsWorkspace,
} from '../fixtures/charts';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function openTrainingHours(page: Page, theme: 'dark' | 'light', state = chartsWorkspace()) {
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.clock.setFixedTime(new Date('2030-01-16T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const selections: unknown[] = [];
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state } });
  });
  await page.route('**/api/plugins/charts/summary', async (route) => {
    const selection = chartsSummaryInputSchema.parse(route.request().postDataJSON());
    selections.push(selection);
    await route.fulfill({ json: chartsSummary(state, selection) });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.goto('/charts');
  await expect(page.getByRole('heading', { name: 'Charts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Training hours/ }).click();
  return selections;
}
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
const valueRow = (page: Page, week: string) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: week, exact: true }) });

for (const theme of ['dark', 'light'] as const)
  test(`training hours reads Calendar weeks and shows exact values (${theme})`, async ({
    page,
  }, info) => {
    const selections = await openTrainingHours(page, theme);
    await expect(page.getByRole('heading', { name: 'Weekly training hours' })).toBeVisible();
    expect(selections).toEqual([
      { template: 'training-hours', weekStart: '2029-10-29', weeks: 12 },
    ]);
    const figure = page.getByRole('figure');
    await expect(figure.locator('.recharts-bar-rectangle')).toHaveCount(10);
    await figure.getByText('View values', { exact: true }).click();
    const table = figure.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(13);
    await expect(valueRow(page, 'Week of 5 Nov')).toContainText('No sessions recorded');
    await expect(valueRow(page, 'Week of 26 Nov')).toContainText('Hill 15 km');
    await expect(valueRow(page, 'Week of 31 Dec')).toContainText(
      '30m (1 of 2 sessions without duration)',
    );
    await expect(valueRow(page, 'Week of 14 Jan (in progress)')).toContainText('No plan');
    await page.mouse.move(-1, -1);
    await page.screenshot({
      path: `.runtime/charts/training-hours-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'All templates' }).click();
    await expect(page.getByRole('list', { name: 'Chart templates' })).toBeVisible();
    await page.screenshot({ path: `.runtime/charts/templates-${info.project.name}-${theme}.png` });
    await page.getByRole('button', { name: /^Training hours/ }).click();
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/charts/training-hours-320-${theme}.png`,
        fullPage: true,
      });
    }
  });

test('training hours chart answers the keyboard with the focused week', async ({ page }) => {
  await openTrainingHours(page, 'dark');
  await page.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.charts-tooltip')).toContainText('Week of');
});

test('training hours asks the server for the season and custom weeks and refuses a reversed range', async ({
  page,
}) => {
  const selections = await openTrainingHours(page, 'dark');
  await page.getByRole('combobox', { name: 'Period' }).selectOption('season');
  await expect
    .poll(() => selections.at(-1))
    .toEqual({ template: 'training-hours', weekStart: '2029-12-31', weeks: 3 });
  await page.getByRole('combobox', { name: 'Period' }).selectOption('custom');
  await page.getByRole('textbox', { name: 'From' }).fill('2029-12-05');
  await page.getByRole('textbox', { name: 'To' }).fill('2030-01-02');
  await expect
    .poll(() => selections.at(-1))
    .toEqual({ template: 'training-hours', weekStart: '2029-12-03', weeks: 5 });
  await page.getByRole('textbox', { name: 'To' }).fill('2029-11-01');
  await expect(page.getByText('Choose an end date on or after the start date.')).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
});

test('changing the period loads only the chart, without reloading the workspace or announcing a save', async ({
  page,
}) => {
  await openTrainingHours(page, 'dark');
  await expect(page.getByRole('heading', { name: 'Weekly training hours' })).toBeVisible();
  const workspaceRequestUrls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/workspace')) workspaceRequestUrls.push(request.url());
  });
  await page.getByRole('combobox', { name: 'Period' }).selectOption('4');
  await page.getByText('View values', { exact: true }).click();
  await expect(page.getByRole('figure').getByRole('table').getByRole('row')).toHaveCount(5);
  await expect(page.getByText(/Your change was saved/)).toHaveCount(0);
  expect(workspaceRequestUrls).toEqual([]);
});

test('a failed period change shows Try again and hides the old weeks', async ({ page }) => {
  const selections = await openTrainingHours(page, 'dark');
  const table = page.getByRole('figure').getByRole('table');
  await page.getByText('View values', { exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(13);
  await page.route('**/api/plugins/charts/summary', (route) => route.fulfill({ status: 500 }), {
    times: 1,
  });
  await page.getByRole('combobox', { name: 'Period' }).selectOption('4');
  await expect(page.getByText('This chart could not load for these dates.')).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('View values', { exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(5);
  expect(selections.at(-1)).toEqual({
    template: 'training-hours',
    weekStart: '2029-12-24',
    weeks: 4,
  });
  await expect(page.getByText('This chart could not load for these dates.')).toHaveCount(0);
});

test('training hours shows an empty state instead of empty axes', async ({ page }, info) => {
  await openTrainingHours(page, 'dark', emptyWorkspace());
  await expect(page.getByRole('heading', { name: 'No training in this period' })).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await page.screenshot({ path: `.runtime/charts/training-hours-empty-${info.project.name}.png` });
});

async function openTrainingBySport(page: Page, theme: 'dark' | 'light') {
  await openTrainingHours(page, theme, mixedSportsWorkspace());
  await page.getByRole('button', { name: 'All templates' }).click();
  await page.getByRole('button', { name: /^Training by sport/ }).click();
  await expect(page.getByRole('heading', { name: 'Weekly training by sport' })).toBeVisible();
}

for (const theme of ['dark', 'light'] as const)
  test(`training by sport stacks each sport and shows exact values (${theme})`, async ({
    page,
  }, info) => {
    await openTrainingBySport(page, theme);
    const figure = page.getByRole('figure');
    await expect(figure.getByRole('list', { name: 'Legend' })).toHaveText(
      /^Running\s*Cycling\s*Winter sports\s*Hiking\s*Swimming\s*Other\s*Planned\s*Race$/,
    );
    await expect(figure.locator('.recharts-bar-rectangle')).toHaveCount(19);
    await figure.getByText('View values', { exact: true }).click();
    await expect(figure.getByRole('columnheader')).toHaveText([
      'Week',
      'Running',
      'Cycling',
      'Winter sports',
      'Hiking',
      'Swimming',
      'Other',
      'Recorded',
      'Planned',
      'Races',
    ]);
    await expect(valueRow(page, 'Week of 26 Nov').getByRole('cell')).toHaveText([
      'Week of 26 Nov',
      '4h',
      'No sessions recorded',
      'No sessions recorded',
      'No sessions recorded',
      'No sessions recorded',
      '4h',
      '8h',
      '8h',
      'Hill 15 km',
    ]);
    await expect(valueRow(page, 'Week of 31 Dec').getByRole('cell').nth(1)).toHaveText(
      'Duration missing',
    );
    await expect(valueRow(page, 'Week of 31 Dec').getByRole('cell').nth(4)).toHaveText('30m');
    await page.mouse.move(-1, -1);
    await page.screenshot({
      path: `.runtime/charts/training-by-sport-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/charts/training-by-sport-320-${theme}.png`,
        fullPage: true,
      });
    }
  });

test('training by sport lists the sports of the focused week in its tooltip', async ({ page }) => {
  await openTrainingBySport(page, 'dark');
  await page.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.charts-tooltip')).toHaveText(
    'Week of 5 NovRecordedNo sessions recordedPlanned6h',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.charts-tooltip')).toHaveText(
    'Week of 12 NovRunning3h 30mCycling3h 30mRecorded7hPlanned7h',
  );
});

async function openChartTemplate(page: Page, theme: 'dark' | 'light', name: string) {
  await openTrainingHours(page, theme, elevationAndHeartRateWorkspace());
  await page.getByRole('button', { name: 'All templates' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}
async function takeWholePageScreenshot(page: Page, path: string) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.width,
    height: await page.evaluate(() => document.documentElement.scrollHeight),
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path });
  await page.setViewportSize(viewport);
}
async function takeScreenshots(page: Page, name: string, project: string, theme: string) {
  await page.mouse.move(-1, -1);
  await takeWholePageScreenshot(page, `.runtime/charts/${name}-${project}-${theme}.png`);
  if (project !== 'mobile') return;
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await takeWholePageScreenshot(page, `.runtime/charts/${name}-320-${theme}.png`);
}

for (const theme of ['dark', 'light'] as const)
  test(`weekly climbing shows elevation per sport and running climb (${theme})`, async ({
    page,
  }, info) => {
    await openChartTemplate(page, theme, 'Weekly climbing');
    const elevation = page
      .getByRole('figure')
      .filter({ hasText: 'Weekly elevation gain by sport' });
    const climb = page.getByRole('figure').filter({ hasText: 'Running climb per kilometre' });
    await expect(elevation.getByRole('list', { name: 'Legend' })).toHaveText(
      /^Running\s*Cycling\s*Winter sports\s*Hiking\s*Race$/,
    );
    await expect(elevation.locator('.recharts-bar-rectangle')).toHaveCount(16);
    await expect(climb.locator('.recharts-line-dots circle')).toHaveCount(7);
    await elevation.getByText('View values', { exact: true }).click();
    await expect(elevation.getByRole('columnheader')).toHaveText([
      'Week',
      'Running',
      'Cycling',
      'Winter sports',
      'Hiking',
      'Races',
    ]);
    await expect(valueRow(page, 'Week of 12 Nov').first().getByRole('cell').nth(1)).toHaveText(
      'Elevation missing',
    );
    await climb.getByText('View values', { exact: true }).click();
    const climbRow = (week: string) =>
      climb.getByRole('row').filter({ has: page.getByRole('cell', { name: week, exact: true }) });
    await expect(climbRow('Week of 5 Nov').getByRole('cell').nth(1)).toHaveText('No running');
    await expect(climbRow('Week of 12 Nov').getByRole('cell').nth(1)).toHaveText('Not measured');
    await expect(climbRow('Week of 29 Oct').getByRole('cell').nth(1)).toHaveText(/^\d+ m\/km$/);
    await takeScreenshots(page, 'weekly-climbing', info.project.name, theme);
  });

for (const theme of ['dark', 'light'] as const)
  test(`workout heart rate shows one sport at a time (${theme})`, async ({ page }, info) => {
    await openChartTemplate(page, theme, 'Workout heart rate');
    const sport = page.getByRole('combobox', { name: 'Sport' });
    await expect(sport).toHaveValue('running');
    const figure = page.getByRole('figure');
    await expect(
      figure.getByRole('heading', { name: 'Running heart rate per session' }),
    ).toBeVisible();
    await expect(figure.locator('.recharts-scatter-symbol')).toHaveCount(8);
    await figure.getByText('View values', { exact: true }).click();
    await expect(
      figure.getByRole('row').filter({ hasText: '30 Oct' }).getByRole('cell').nth(2),
    ).toHaveText('No heart rate');
    await takeScreenshots(page, 'workout-heart-rate', info.project.name, theme);
    await sport.selectOption('cycling');
    await expect(
      figure.getByRole('heading', { name: 'Cycling heart rate per session' }),
    ).toBeVisible();
  });

test('workout heart rate explains an empty period', async ({ page }) => {
  await openTrainingHours(page, 'dark', mixedSportsWorkspace());
  await page.getByRole('button', { name: 'All templates' }).click();
  await page.getByRole('button', { name: /^Workout heart rate/ }).click();
  await expect(page.getByRole('heading', { name: 'No heart rate in this period' })).toBeVisible();
  await expect(page.getByText('20 recorded sessions have no average heart rate.')).toBeVisible();
});

for (const theme of ['dark', 'light'] as const)
  test(`resting heart rate and HRV show nights, average and usual range (${theme})`, async ({
    page,
  }, info) => {
    await openTrainingHours(page, theme, nightsWorkspace());
    await page.getByRole('button', { name: 'All templates' }).click();
    await page.getByRole('button', { name: /^Resting heart rate and HRV/ }).click();
    const resting = page.getByRole('figure').filter({ hasText: 'Resting heart rate' }).first();
    const hrv = page.getByRole('figure').filter({ hasText: 'Heart rate variability (HRV)' });
    await expect(resting.getByRole('list', { name: 'Legend' })).toHaveText(
      /^Night\s*7-day average\s*Usual range$/,
    );
    await expect(resting).toContainText('Garmin reported the lowest heart rate of the day');
    await hrv.getByText('View values', { exact: true }).click();
    const night = (date: string) =>
      hrv.getByRole('row').filter({ has: page.getByRole('cell', { name: date, exact: true }) });
    await expect(night('20 Dec').getByRole('cell')).toHaveText([
      '20 Dec',
      /^\d+ ms$/,
      /^\d+ ms$/,
      /^\d+ to \d+ ms$/,
    ]);
    await expect(hrv.locator('.recharts-area-area')).toHaveCount(1);
    await takeScreenshots(page, 'resting-heart-rate-hrv', info.project.name, theme);
  });

test('resting heart rate and HRV show an empty state without nights', async ({ page }) => {
  await openTrainingHours(page, 'dark', chartsWorkspace());
  await page.getByRole('button', { name: 'All templates' }).click();
  await page.getByRole('button', { name: /^Resting heart rate and HRV/ }).click();
  await expect(
    page.getByRole('heading', { name: 'No overnight data in this period' }),
  ).toBeVisible();
});
