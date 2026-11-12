import { test, expect, type Page } from '@playwright/test';
import { printableWeekFixture } from '../fixtures/printable-week';

const enabled = process.env.PRINTABLE_TRAINING_WEEK_E2E === 'true';
const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar' })).toBeVisible();
}

async function preview(
  page: Page,
  options: { sunday?: boolean; imperial?: boolean; long?: boolean } = {},
) {
  await login(page);
  const response = await page.request.get('/api/workspace?from=2030-01-07&to=2030-02-03');
  expect(response.ok()).toBe(true);
  const envelope = await response.json();
  const state = printableWeekFixture();
  state.profile!.weekStartsOnPreference = options.sunday ? 'sunday' : 'monday';
  state.profile!.units = options.imperial ? 'imperial' : 'metric';
  if (options.long) {
    state.workouts[0].exercises = Array.from({ length: 36 }, (_, index) => ({
      name: `Exercise ${index + 1} with a deliberately long prescription title`,
      sets: 3,
      repetitions: '8–10 reps',
      weightKg: 20,
      restSeconds: 90,
      instructions:
        `Instruction ${index + 1}: preserve all prescribed details across printed pages. ` +
        'Long note with readable wrapping. '.repeat(5),
    }));
    state.workouts[0].notes =
      'Final exercise note.\n\n| Detail | Value |\n| --- | --- |\n| Long value | ' +
      'unbrokentext'.repeat(30) +
      ' |';
  }
  await page.clock.setFixedTime(new Date('2030-01-09T10:00:00Z'));
  let fail = false;
  await page.route('**/api/workspace?**', async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Synthetic refresh failure' } },
      });
    await route.fulfill({ json: { ...envelope, state } });
  });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/plugins/'))
      writes.push(request.url());
  });
  await page.goto('/printable-training-week');
  await expect(
    page.getByRole('heading', { name: 'Printable training week', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Morning intervals' })).toBeVisible();
  return {
    writes,
    failRefresh: (value: boolean) => {
      fail = value;
    },
  };
}

test('default composition omits both example routes from navigation', async ({ page }) => {
  test.skip(enabled, 'Default composition is checked separately from the enabled example.');
  await login(page);
  for (const path of ['/cycling-sleep', '/printable-training-week']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'This workspace is not available' }),
    ).toBeVisible();
    expect(await page.locator(`a[href="${path}"]`).count()).toBe(0);
  }
});

test.describe('explicitly enabled printable example', () => {
  test.skip(!enabled, 'Build the isolated composition with Printable training week enabled.');

  for (const theme of ['dark', 'light']) {
    test(`previews and prints prescribed sessions with optional notes in ${theme}`, async ({
      page,
    }, info) => {
      const { writes } = await preview(page);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const sheet = page.getByRole('region', { name: 'Printable training week preview' });
      await expect(sheet.getByRole('heading', { name: '7 Jan — 13 Jan 2030' })).toBeVisible();
      await expect(sheet.locator('.printable-week-session h3')).toHaveText([
        'Morning intervals',
        'Evening strength',
        'Easy ride',
        'Rest and reset',
        'Pool technique',
      ]);
      await expect(sheet).toContainText('45 min 5 sec');
      await expect(sheet).toContainText('Repeat 4 times');
      await expect(sheet).toContainText('Until lap button');
      await expect(sheet).toContainText('400 m · 5:00–5:30 / km');
      await expect(sheet).toContainText('3 sets · 8–10 reps · 20 kg · 1 min 30 sec rest');
      await expect(sheet).toContainText('Duration not specified');
      await expect(sheet).toContainText('0 m ascent');
      await expect(sheet).not.toContainText('Private completion note');
      await expect(sheet).not.toContainText('Workout note');
      await expect(sheet).not.toContainText('Warm-up note');
      await expect(sheet).not.toContainText('Exercise instruction note');
      const notes = page.getByRole('checkbox', { name: 'Include notes' });
      await notes.focus();
      await page.keyboard.press('Space');
      await expect(sheet).toContainText('Workout note');
      await expect(sheet).toContainText('Interval note');
      await expect(sheet).toContainText('Exercise instruction note');
      await expect(sheet).not.toContainText('Private completion note');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/printable-week-review/${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.evaluate(() => {
        window.print = () => {
          document.body.dataset.printRequested = 'true';
        };
      });
      await page.getByRole('button', { name: 'Print / save PDF' }).click();
      await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('.printable-week-controls')).not.toBeVisible();
      await expect(page.locator('.sidebar')).not.toBeVisible();
      await expect(page.locator('.mobile-bar')).not.toBeVisible();
      expect(await sheet.evaluate((element) => getComputedStyle(element).color)).toBe(
        'rgb(0, 0, 0)',
      );
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('.page-content')).toHaveCSS('opacity', '1');
      await expect(page.locator('.page-content')).toHaveCSS('animation-name', 'none');
      if (info.project.name === 'desktop') {
        await page.pdf({
          path: `.runtime/printable-week-review/week-${theme}.pdf`,
          format: 'A4',
          margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
        });
      }
      expect(writes).toEqual([]);
      // Print CSS must not leak after the plugin's page unmounts.
      await page.emulateMedia({ media: 'screen' });
      const opener = page.getByRole('button', { name: 'Open navigation' });
      if (await opener.isVisible()) await opener.click();
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Calendar', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'Training calendar' })).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      await expect(
        page.locator(info.project.name === 'mobile' ? '.mobile-bar' : '.sidebar'),
      ).toBeVisible();
    });
  }

  test('uses Sunday weeks and imperial units and retains the last loaded week on failure', async ({
    page,
  }) => {
    const { failRefresh, writes } = await preview(page, { sunday: true, imperial: true });
    const sheet = page.getByRole('region', { name: 'Printable training week preview' });
    await expect(sheet.getByRole('heading', { name: '6 Jan — 12 Jan 2030' })).toBeVisible();
    await expect(sheet).not.toContainText('Pool technique');
    await expect(sheet).toContainText('44.092 lb');
    await expect(sheet).toContainText('8:03–8:51 / mi');
    await page.getByLabel('Week containing').fill('2030-01-23');
    failRefresh(true);
    await page.getByRole('button', { name: 'Show week', exact: true }).click();
    await expect(page.getByText('Synthetic refresh failure')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: '6 Jan — 12 Jan 2030' })).toBeVisible();
    failRefresh(false);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(sheet.getByRole('heading', { name: '20 Jan — 26 Jan 2030' })).toBeVisible();
    await expect(sheet).toContainText('No sessions planned for this week.');
    await expect(sheet.locator('.printable-week-free')).toHaveCount(7);
    expect(writes).toEqual([]);
  });

  test('wraps long prescriptions and exports every exercise across pages', async ({
    page,
  }, info) => {
    await preview(page, { long: true });
    await page.getByRole('checkbox', { name: 'Include notes' }).check();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(
        page.getByText('Exercise 36 with a deliberately long prescription title'),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('.page-content')).toHaveCSS('opacity', '1');
      await expect(page.locator('.page-content')).toHaveCSS('animation-name', 'none');
      if (info.project.name === 'desktop') {
        await page.pdf({
          path: `.runtime/printable-week-review/long-${theme}.pdf`,
          format: 'A4',
          margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
        });
      }
      await page.emulateMedia({ media: 'screen' });
    }
  });
});
