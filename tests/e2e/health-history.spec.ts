import { test, expect, type Page } from '@playwright/test';
import { emptyWorkspace, profileSchema } from '@athlete-panel/contracts';
import { health } from '../fixtures/calendar';
import { addDays } from '../../packages/ui/src/calendar-dates';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function navigate(page: Page, name: string) {
  const opener = page.getByRole('button', { name: 'Open navigation' });
  if (await opener.isVisible()) await opener.click();
  const link = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).not.toBeVisible();
}

async function chooseHistoryDate(page: Page, date: string) {
  await page.getByRole('button', { name: /^Choose history dates/ }).click();
  await page.getByLabel('Jump to date', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Show period', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'History date picker' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Choose history dates/ })).toBeFocused();
}

async function preview(page: Page, timezone = 'Europe/Paris', weekStartsOnPreference = 'monday') {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar' })).toBeVisible();
  const response = await page.request.get('/api/workspace?from=2026-10-04&to=2026-11-02');
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  const state = emptyWorkspace();
  state.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex (synthetic)',
    timezone,
    weekStartsOnPreference,
  });
  state.health = [
    ...Array.from({ length: 90 }, (_, index) =>
      health(
        1000 + index,
        addDays('2026-11-02', -index),
        'sleepDurationSeconds',
        index % 8 === 3 ? null : 7 * 3600 + (index % 5) * 900,
      ),
    ),
    health(2000, '2026-11-02', 'steps', 0),
    health(2001, '2026-11-02', 'hrvMilliseconds', 54),
    health(2002, '2026-11-03', 'sleepDurationSeconds', 20 * 3600),
  ];
  const requests: { from: string; to: string }[] = [];
  await page.clock.setFixedTime(new Date('2026-11-02T00:30:00Z'));
  await page.route('**/api/workspace?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from')!;
    const to = params.get('to')!;
    requests.push({ from, to });
    await route.fulfill({
      json: {
        ...envelope,
        state: {
          ...state,
          health: state.health.filter(
            (record) => record.localDate >= from && record.localDate <= to,
          ),
        },
      },
    });
  });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Training calendar' })).toBeVisible();
  return { requests, state };
}

for (const theme of ['dark', 'light']) {
  test(`Health history stays separate from Calendar and renders all periods in ${theme}`, async ({
    page,
  }, info) => {
    const { requests } = await preview(page);
    if (theme === 'light')
      await page
        .getByRole('button', {
          name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
          exact: true,
        })
        .click();
    await page.getByLabel('Go to date').fill('2030-01-07');
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
    await navigate(page, 'Health');
    await expect(page.locator('.health-history-range')).toHaveText('4 Oct – 2 Nov 2026');
    await expect(page.locator('.mini-column')).toHaveCount(30);
    await expect(page.locator('.health-hero-label')).toHaveText('26 of 30 nights recorded');
    await expect(page.locator('.health-hero-value')).toHaveText('7h 29m');
    expect(requests).toContainEqual({ from: '2026-10-04', to: '2026-11-02' });
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Jump to date', { exact: true })).not.toBeVisible();
    const rangeButton = page.getByRole('button', { name: /^Choose history dates/ });
    await rangeButton.focus();
    await page.keyboard.press('Enter');
    const dateInput = page.getByLabel('Jump to date', { exact: true });
    await expect(dateInput).toBeFocused();
    await expect(dateInput).toHaveAttribute('max', '2026-11-02');
    await dateInput.fill('2026-11-03');
    await expect(page.getByRole('button', { name: 'Show period', exact: true })).toBeDisabled();
    await dateInput.fill('2025-01-01');
    await expect(page.locator('.health-history-range')).toHaveText('4 Oct – 2 Nov 2026');
    await page.keyboard.press('Escape');
    await expect(dateInput).not.toBeVisible();
    await expect(rangeButton).toBeFocused();
    for (const days of [7, 90, 30]) {
      await page.getByRole('radio', { name: `${days} days`, exact: true }).click();
      await expect(page.getByRole('radio', { name: `${days} days`, exact: true })).toBeChecked();
      await expect(page.locator('.mini-column')).toHaveCount(days);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 900, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('.health-history-controls button').evaluateAll((buttons) =>
        buttons
          .map((button) => ({
            label: button.getAttribute('aria-label') || button.textContent,
            width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height,
          }))
          .filter(({ width, height }) => width < 44 || height < 44),
      ),
    ).toEqual([]);
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.locator('.health-history-range')).toHaveText('4 Sept – 3 Oct 2026');
    await expect(page.locator('.mini-column')).toHaveCount(30);
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
    await chooseHistoryDate(page, '2026-10-30');
    await expect(page.locator('.health-history-range')).toHaveText('1 Oct – 30 Oct 2026');
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.locator('.health-history-range')).toHaveText('4 Oct – 2 Nov 2026');
    await page.getByLabel('Health metric').selectOption('steps');
    await expect(page.getByRole('img', { name: /2 Nov: 0/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /4 Oct: unknown/ })).toBeVisible();
    await page.locator('.health-history-values summary').click();
    const values = page.getByRole('region', { name: 'Daily measurements', exact: true });
    await expect(values.locator('dl > div').first()).toHaveText('2 Nov 20260 steps');
    await expect(values.locator('dl > div').last()).toHaveText('4 Oct 2026Not recorded');
    await chooseHistoryDate(page, '2025-01-01');
    await expect(page.locator('.health-history-range')).toHaveText('3 Dec 2024 – 1 Jan 2025');
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.setViewportSize(viewport);
    }
    await expect(
      page.getByRole('heading', { name: 'No health records for these dates' }),
    ).toBeVisible();
    await expect(page.locator('.health-hero')).toHaveCount(0);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(rangeButton).toBeFocused();
    await page.getByRole('radio', { name: '7 days', exact: true }).click();
    await navigate(page, 'Calendar');
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
    await navigate(page, 'Health');
    await expect(page.locator('.mini-column')).toHaveCount(30);
    await expect(page.locator('.health-history-range')).toHaveText('4 Oct – 2 Nov 2026');
    await page.getByRole('radio', { name: '90 days', exact: true }).click();
    await page.goBack();
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
    await page.goForward();
    await expect(page.locator('.mini-column')).toHaveCount(30);
    await page.reload();
    await expect(page.locator('.mini-column')).toHaveCount(30);
  });
}

test('Health uses the athlete timezone independently of Sunday week starts', async ({ page }) => {
  const { requests } = await preview(page, 'America/Los_Angeles', 'sunday');
  await navigate(page, 'Health');
  await expect(page.locator('.mini-column')).toHaveCount(30);
  await expect(page.locator('.health-history-range')).toHaveText('3 Oct – 1 Nov 2026');
  expect(requests).toContainEqual({ from: '2026-10-03', to: '2026-11-01' });
  await chooseHistoryDate(page, '2026-03-09');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator('.health-history-range')).toHaveText('3 Oct – 1 Nov 2026');
});

test('Health hides stale data during failed and overlapping range requests, then retries', async ({
  page,
}) => {
  await preview(page);
  await navigate(page, 'Health');
  await expect(page.locator('.mini-column')).toHaveCount(30);
  await page.route('**/api/workspace?from=2026-10-27&to=2026-11-02', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Synthetic outage' } } }),
  );
  await page.getByRole('radio', { name: '7 days', exact: true }).click();
  await expect(page.locator('.health-history-error').getByRole('alert')).toContainText(
    'Unable to load health history',
  );
  await expect(page.locator('.health-hero')).toHaveCount(0);
  await expect(page.locator('.mini-chart')).toHaveCount(0);
  await page.unroute('**/api/workspace?from=2026-10-27&to=2026-11-02');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.mini-column')).toHaveCount(7);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/workspace?from=2026-10-04&to=2026-11-02', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.getByRole('radio', { name: '30 days', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading health history');
  await expect(page.locator('.health-hero')).toHaveCount(0);
  await page.getByRole('radio', { name: '90 days', exact: true }).click();
  await expect(page.locator('.mini-column')).toHaveCount(90);
  release();
  await expect(page.locator('.health-history-range')).toHaveText('5 Aug – 2 Nov 2026');
  await expect(page.locator('.mini-column')).toHaveCount(90);
});
