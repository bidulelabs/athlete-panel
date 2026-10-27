import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function navigate(page: Page, name: string) {
  const opener = page.getByRole('button', { name: 'Open navigation' });
  if (await opener.isVisible()) await opener.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).not.toBeVisible();
}
async function state(page: Page) {
  const response = await page.request.get('/api/workspace?from=2029-12-31&to=2030-01-27');
  expect(response.ok()).toBe(true);
  return (await response.json()).state;
}
async function mutate(page: Page, commands: unknown[]) {
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: new URL(page.url()).origin },
    data: { idempotencyKey: randomUUID(), commands },
  });
  expect(response.ok()).toBe(true);
}
async function setPreference(page: Page, preference: string) {
  await navigate(page, 'Settings');
  await page.getByRole('combobox', { name: /First day of the week/ }).selectOption(preference);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');
}

test('saved week starts align headings, navigation and totals without moving workouts', async ({
  page,
}, info) => {
  await login(page);
  const original = (await state(page)).profile;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  try {
    await mutate(
      page,
      ids.map((id, index) => ({
        action: 'workout.create',
        values: {
          id,
          title: `Week boundary ${index}`,
          sport: 'cycling',
          durationSeconds: [1800, 3600, 7200][index],
          schedule: {
            kind: 'independent',
            date: ['2030-01-05', '2030-01-06', '2030-01-07'][index],
          },
        },
      })),
    );
    await setPreference(page, 'monday');
    await navigate(page, 'Calendar');
    await page.getByLabel('Go to date').fill('2030-01-06');
    await expect(page.getByLabel('Go to date')).toHaveValue('2029-12-31');
    await expect(page.locator('.calendar-weekdays span').first()).toHaveText('Mon');
    await expect(page.locator('.week-summary-header').first()).toContainText('1h 30m');

    await setPreference(page, 'sunday');
    await expect(page.locator('.availability-grid input').first()).toHaveAttribute(
      'name',
      'sunday',
    );
    await navigate(page, 'Calendar');
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-06');
    await expect(page.locator('.calendar-weekdays span')).toHaveText([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
    await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', '2030-01-06');
    await expect(page.locator('.week-summary-header').first()).toContainText('3h');
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-13');
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-06');
    await page.reload();
    await page.getByLabel('Go to date').fill('2030-01-06');
    await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', '2030-01-06');
    const saved = await state(page);
    expect(saved.profile.weekStartsOnPreference).toBe('sunday');
    expect(
      ids.map(
        (id) => saved.workouts.find((workout: { id: string }) => workout.id === id).schedule.date,
      ),
    ).toEqual(['2030-01-05', '2030-01-06', '2030-01-07']);
    await page.screenshot({
      path: `.runtime/browser/week-start-${info.project.name}-dark.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('button', {
        name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
        exact: true,
      })
      .click();
    await page.screenshot({
      path: `.runtime/browser/week-start-${info.project.name}-light.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await navigate(page, 'Settings');
    await expect(page.getByRole('combobox', { name: /First day of the week/ })).toHaveValue(
      'sunday',
    );
    await page.screenshot({
      path: `.runtime/browser/week-preference-${info.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    const current = (await state(page)).profile;
    const { id: _id, revision: _revision, ...values } = original;
    await mutate(page, [
      { action: 'profile.set', expectedRevision: current.revision, values },
      ...ids.map((id) => ({ action: 'workout.delete', id, expectedRevision: 1 })),
    ]);
  }
});

test('Automatic follows browser region, while Today follows the athlete timezone', async ({
  page,
  browser,
}) => {
  await login(page);
  const original = (await state(page)).profile;
  const { id: _id, revision: _revision, ...values } = original;
  try {
    await mutate(page, [
      {
        action: 'profile.set',
        expectedRevision: original.revision,
        values: { ...values, weekStartsOnPreference: 'auto', timezone: 'America/Los_Angeles' },
      },
    ]);
    for (const [locale, heading, first] of [
      ['en-US', 'Sun', '2026-10-18'],
      ['fr-FR', 'Mon', '2026-10-19'],
    ]) {
      const context = await browser.newContext({
        locale,
        timezoneId: 'Europe/Paris',
        storageState: await page.context().storageState(),
      });
      try {
        const regional = await context.newPage();
        await regional.clock.setFixedTime(new Date('2026-10-25T00:30:00Z'));
        await regional.goto('/calendar');
        await expect(regional.locator('.calendar-weekdays span').first()).toHaveText(heading);
        await expect(regional.getByLabel('Go to date')).toHaveValue(first);
        await expect(regional.locator('.calendar-day.is-today')).toHaveAttribute(
          'data-date',
          '2026-10-24',
        );
        await regional.getByLabel('Go to date').fill('2030-01-06');
        await regional.getByRole('button', { name: 'Today', exact: true }).click();
        await expect(regional.getByLabel('Go to date')).toHaveValue(first);
      } finally {
        await context.close();
      }
    }
  } finally {
    await mutate(page, [
      { action: 'profile.set', expectedRevision: (await state(page)).profile.revision, values },
    ]);
  }
});

test('failed preference saves retain the choice and allow retry', async ({ page }) => {
  await login(page);
  const original = (await state(page)).profile;
  try {
    await navigate(page, 'Settings');
    await page.getByRole('combobox', { name: /First day of the week/ }).selectOption('sunday');
    await page.route(
      '**/api/plugins/training/mutate',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic outage' }),
        }),
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.locator('.profile-layout').getByRole('alert')).toContainText(
      'Synthetic outage',
    );
    await expect(page.getByRole('combobox', { name: /First day of the week/ })).toHaveValue(
      'sunday',
    );
    expect((await state(page)).profile.revision).toBe(original.revision);
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Profile saved.');
  } finally {
    const { id: _id, revision: _revision, ...values } = original;
    await mutate(page, [
      { action: 'profile.set', expectedRevision: (await state(page)).profile.revision, values },
    ]);
  }
});
