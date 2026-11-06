import { test, expect, type Page } from '@playwright/test';
import { chartsSummaryInputSchema, type ChartsSummaryInput } from '@athlete-panel/contracts';
import { chartsSummary } from '../../plugins/charts/summary';
import { elevationAndHeartRateWorkspace } from '../fixtures/charts';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function openCharts(page: Page, theme = 'dark') {
  const state = elevationAndHeartRateWorkspace();
  state.workouts = state.workouts.map((item, index) => ({
    ...item,
    sport: index % 2 ? 'cycling' : 'running',
  }));
  const selections: ChartsSummaryInput[] = [];
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.clock.setFixedTime(new Date('2030-01-16T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state } });
  });
  await page.route('**/api/plugins/charts/summary', async (route) => {
    const input = chartsSummaryInputSchema.parse(route.request().postDataJSON());
    selections.push(input);
    await route.fulfill({ json: chartsSummary(state, input) });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.goto('/charts');
  await page.getByRole('button', { name: /^Training hours/ }).click();
  await expect(page.getByRole('heading', { name: 'Weekly training hours' })).toBeVisible();
  return selections;
}

async function onlySport(page: Page, sport: string) {
  const trigger = page.getByRole('button', { name: /^Sports:/ });
  await trigger.click();
  await page.getByRole('button', { name: `Only ${sport}`, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName(`Sports: ${sport}`);
}
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

for (const theme of ['dark', 'light']) {
  test(`volume controls filter both totals and group without changing dates (${theme})`, async ({
    page,
  }, info) => {
    const selections = await openCharts(page, theme);
    const workspaceRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/workspace')) workspaceRequests.push(request.url());
    });
    await onlySport(page, 'Running');
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
    await expect(page.getByRole('heading', { name: 'Monthly training hours' })).toBeVisible();
    await expect(page.getByRole('figure')).toContainText('Oct 2029');
    await page.getByRole('application').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.charts-tooltip')).toContainText('October 2029 (partial)');
    await expect(page.locator('.charts-tooltip')).toContainText('Recorded3h');
    await page.getByText('View values', { exact: true }).click();
    const table = page.getByRole('figure').getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(5);
    const row = (name: string) =>
      table.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
    await expect(row('October 2029 (partial)')).toContainText('3h');
    await expect(row('November 2029')).toHaveText(/November 2029\s*7h 30m\s*14h/);
    await expect(row('January 2030 (partial) (in progress)')).toContainText(
      '1h (1 of 2 sessions without duration)',
    );
    await expect
      .poll(() => selections.at(-1))
      .toMatchObject({
        weekStart: '2029-10-29',
        weeks: 12,
        grouping: 'month',
        sports: ['running'],
      });
    await page.screenshot({
      path: `.runtime/charts/volume-month-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('day');
    await expect(page.getByRole('heading', { name: 'Daily training hours' })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(85);
    await expect(row('30 Oct')).toHaveText(/30 Oct\s*3h\s*3h/);
    await expect(row('29 Oct')).toContainText('No sessions recorded');
    await expect
      .poll(() => selections.at(-1))
      .toMatchObject({ weekStart: '2029-10-29', weeks: 12, grouping: 'day', sports: ['running'] });
    expect(workspaceRequests).toEqual([]);
    await page.getByRole('button', { name: /^Sports:/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Running', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Cycling', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'Running', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect.poll(() => selections.at(-1)?.sports).toEqual(['running', 'cycling']);
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole('button', { name: /^Sports:/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const picker = page.getByRole('dialog', { name: 'Choose sports' });
    await expect(picker).toBeVisible();
    const box = await picker.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
    await page.screenshot({
      path: `.runtime/charts/volume-picker-${info.project.name}-${theme}.png`,
    });
    await page.getByRole('button', { name: 'All sports', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Sports: All sports' })).toBeVisible();
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole('button', { name: /^Sports:/ }).click();
      const landscapeBox = await picker.boundingBox();
      expect(landscapeBox!.y).toBeGreaterThanOrEqual(0);
      expect(landscapeBox!.y + landscapeBox!.height).toBeLessThanOrEqual(390);
      await page.getByRole('button', { name: 'Only Other', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Other', exact: true })).toBeChecked();
      await page.screenshot({ path: `.runtime/charts/volume-picker-landscape-${theme}.png` });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Sports: Other', exact: true })).toBeVisible();
    }
  });

  test(`sport breakdown and climbing share controls while other templates keep their views (${theme})`, async ({
    page,
  }, info) => {
    await openCharts(page, theme);
    await page.getByRole('button', { name: 'All templates', exact: true }).click();
    await page.getByRole('button', { name: /^Training by sport/ }).click();
    await onlySport(page, 'Cycling');
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
    await expect(page.getByRole('heading', { name: 'Monthly training by sport' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Legend' })).toHaveText(
      /^Cycling\s*Planned\s*Race$/,
    );
    await page.getByText('View values', { exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Running', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'All templates', exact: true }).click();
    await page.getByRole('button', { name: /^Weekly climbing/ }).click();
    await expect(page.getByRole('figure')).toHaveCount(2);
    await onlySport(page, 'Cycling');
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
    await expect(
      page.getByRole('heading', { name: 'Monthly elevation gain by sport' }),
    ).toBeVisible();
    await expect(page.getByRole('figure')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Running climb/ })).toHaveCount(0);
    await page.screenshot({
      path: `.runtime/charts/volume-climbing-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    for (const name of [
      'Workout heart rate',
      'Resting heart rate and HRV',
      'Estimated training load',
    ]) {
      await page.getByRole('button', { name: 'All templates', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole('combobox', { name: 'Group by' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Sports:/ })).toHaveCount(0);
      if (name === 'Workout heart rate')
        await expect(page.getByRole('combobox', { name: 'Sport', exact: true })).toBeVisible();
    }
  });

  test(`52-week daily sport bars retain visible color at narrow widths (${theme})`, async ({
    page,
  }, info) => {
    await openCharts(page, theme);
    for (const template of ['Training by sport', 'Weekly climbing']) {
      await page.getByRole('button', { name: 'All templates', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^${template}`) }).click();
      await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('52');
      await page.getByRole('combobox', { name: 'Group by' }).selectOption('day');
      const figure = page.getByRole('figure').first();
      await expect(figure.getByRole('heading')).toHaveText(/^Daily /);
      await expect(figure).toHaveAttribute('aria-busy', 'false');
      await figure.getByText('View values', { exact: true }).click();
      await expect(figure.getByRole('table').getByRole('row')).toHaveCount(365);
      await figure.getByText('View values', { exact: true }).click();
      for (const width of info.project.name === 'mobile' ? [412, 320] : [1440]) {
        await page.setViewportSize({ width, height: 915 });
        // Visibility alone misses this bug: SVG borders can paint over an entire filled bar.
        await expect
          .poll(() =>
            figure.locator('.recharts-bar-rectangle .recharts-rectangle').evaluateAll((bars) => {
              const filled = bars.flatMap((bar) => {
                const { width, height } = (bar as SVGGraphicsElement).getBBox();
                const style = getComputedStyle(bar);
                if (
                  width <= 0 ||
                  height <= 0 ||
                  ['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(style.fill)
                )
                  return [];
                const border =
                  style.stroke === 'none' || style.stroke === style.fill
                    ? 0
                    : Number.parseFloat(style.strokeWidth);
                return [{ width: width - border, height: height - border }];
              });
              return {
                hasRecordedBars: filled.length > 0,
                hiddenByBorder: filled.filter((bar) => bar.width <= 0 || bar.height <= 0).length,
              };
            }),
          )
          .toEqual({ hasRecordedBars: true, hiddenByBorder: 0 });
        await page.screenshot({
          path: `.runtime/charts/daily-bars-${template.replaceAll(' ', '-')}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
      await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
      await expect(figure.getByRole('heading')).toHaveText(/^Monthly /);
      await expect
        .poll(() =>
          figure
            .locator('.recharts-bar-rectangle .recharts-rectangle')
            .evaluateAll((bars) =>
              bars.some(
                (bar) =>
                  bar.getAttribute('fill') === 'transparent' &&
                  getComputedStyle(bar).stroke !== 'none' &&
                  Number.parseFloat(getComputedStyle(bar).strokeWidth) > 0,
              ),
            ),
        )
        .toBe(true);
    }
  });
}

test('a failed sport selection hides the previous chart and retry keeps the chosen sports and grouping', async ({
  page,
}) => {
  const selections = await openCharts(page);
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
  await expect(page.getByRole('heading', { name: 'Monthly training hours' })).toBeVisible();
  await page.route('**/api/plugins/charts/summary', (route) => route.fulfill({ status: 503 }), {
    times: 1,
  });
  await onlySport(page, 'Cycling');
  await expect(page.getByText('This chart could not load for these dates.')).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Monthly training hours' })).toBeVisible();
  expect(selections.at(-1)).toMatchObject({ grouping: 'month', sports: ['cycling'] });
});

test('a slower previous grouping cannot replace the current result', async ({ page }) => {
  await openCharts(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/plugins/charts/summary', async (route) => {
    const input = chartsSummaryInputSchema.parse(route.request().postDataJSON());
    if (input.grouping !== 'month') return route.fallback();
    await held;
    await route
      .fulfill({ json: chartsSummary(elevationAndHeartRateWorkspace(), input) })
      .catch(() => {});
  });
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('month');
  await expect(page.getByRole('figure')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('day');
  await expect(page.getByRole('heading', { name: 'Daily training hours' })).toBeVisible();
  release();
  await page.getByText('View values', { exact: true }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(85);
  await expect(page.getByRole('heading', { name: 'Monthly training hours' })).toHaveCount(0);
});
