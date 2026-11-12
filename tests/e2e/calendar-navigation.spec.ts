import { test, expect, type Page, type Locator } from '@playwright/test';
import { noteSchema } from '@athlete-panel/contracts';
import { calendarFixture, calendarId } from '../fixtures/calendar';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page, theme = 'dark') {
  if (test.info().project.name === 'desktop')
    await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.clock.setFixedTime(new Date('2030-01-10T00:30:00Z'));
  const data = calendarFixture();
  data.profile!.timezone = 'America/Los_Angeles';
  data.injuries[1]!.endDate = '2030-01-14';
  for (const [week, date] of ['2030-01-07', '2030-01-14', '2030-01-21'].entries()) {
    for (let index = 0; index < 6; index++) {
      data.notes.push(
        noteSchema.parse({
          id: calendarId(100 + week * 10 + index),
          revision: 1,
          title: `Planning note ${week + 1}.${index + 1}`,
          body: 'Synthetic planning context. Keep an easy pace and leave time to recover.',
          schedule: { kind: 'independent', date },
        }),
      );
    }
  }
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) writes++;
  });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state: data } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
  return { data, writes: () => writes };
}

async function expectUncovered(page: Page, target: Locator) {
  await expect
    .poll(async () => {
      const bar = await page.locator('.calendar-sticky').boundingBox();
      const box = await target.boundingBox();
      return (
        !!bar && !!box && box.y >= bar.y + bar.height - 1 && box.y < page.viewportSize()!.height
      );
    })
    .toBe(true);
}

function dayAdd(page: Page, date: string) {
  return page.locator(`[data-date="${date}"]`).getByRole('button', { name: /^Add to / });
}

for (const theme of ['light', 'dark']) {
  test(`sticky navigation, weekday alignment and overlays in ${theme}`, async ({ page }, info) => {
    const { writes } = await preview(page, theme);
    await page
      .getByRole('button', { name: /^Expand summary/ })
      .first()
      .click();
    await page.locator('[data-date="2030-01-21"]').scrollIntoViewIfNeeded();
    const sticky = page.locator('.calendar-sticky');
    const mobile = info.project.name === 'mobile';
    await expect.poll(async () => (await sticky.boundingBox())!.y).toBe(mobile ? 56 : 0);
    for (const name of ['Previous week', 'Today', 'Next week']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeInViewport();
      if (mobile) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('heading', { name: 'Training calendar' })).not.toBeInViewport();
    if (mobile) {
      await expect(page.locator('.calendar-weekdays')).toBeHidden();
    } else {
      await expect(page.locator('.calendar-weekdays')).toBeInViewport();
      await expect(page.locator('.week-summary-header').first()).not.toBeInViewport();
      const labels = page.locator('.calendar-weekdays > span');
      const days = page.locator('.calendar-week').last().locator('.calendar-day');
      for (let index = 0; index < 7; index++) {
        expect(
          Math.abs(
            (await labels.nth(index).boundingBox())!.x - (await days.nth(index).boundingBox())!.x,
          ),
        ).toBeLessThan(2);
      }
    }
    await page.screenshot({
      path: `.runtime/calendar-navigation/${info.project.name}-${theme}-scrolled.png`,
    });
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expectUncovered(page, page.locator('[data-date="2030-01-09"]'));
    const card = page.getByRole('button', { name: 'Open Steady endurance ride', exact: true });
    await card.click();
    const inspector = page.getByRole('complementary', { name: 'Workout details' });
    await expect(inspector).toBeVisible();
    if (!mobile) {
      const label = await page.locator('.calendar-weekdays > span').last().boundingBox();
      const day = await page
        .locator('.calendar-week')
        .first()
        .locator('.calendar-day')
        .last()
        .boundingBox();
      expect(Math.abs(label!.x - day!.x)).toBeLessThan(2);
      await expectUncovered(page, inspector.getByRole('button', { name: 'Close workout details' }));
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await expect(page.getByRole('dialog', { name: 'Workout details', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Close workout details' }).click();
    await expect(card).toBeFocused();
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.getByRole('button', { name: 'Today', exact: true }).click();
      await expectUncovered(page, page.locator('[data-date="2030-01-09"]'));
      await expect(page.getByLabel('Go to date')).toBeInViewport();
      await page.screenshot({ path: `.runtime/calendar-navigation/phone-narrow-${theme}.png` });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(writes()).toBe(0);
  });

  test(`day creation is discoverable and returns focus without scrolling in ${theme}`, async ({
    page,
  }, info) => {
    const { writes } = await preview(page, theme);
    const day = page.locator('[data-date="2030-01-14"]');
    await day.scrollIntoViewIfNeeded();
    const add = dayAdd(page, '2030-01-14');
    const empty = dayAdd(page, '2030-01-25');
    if (info.project.name === 'desktop') {
      await page.mouse.move(0, 0);
      await expect(add).toHaveCSS('opacity', '0');
      await expect(empty).toHaveCSS('opacity', '1');
      const before = await day.boundingBox();
      await day.hover();
      await expect(add).toHaveCSS('opacity', '1');
      expect((await day.boundingBox())!.height).toBe(before!.height);
      const lastCard = day.locator('.calendar-day-content > button').nth(-2);
      const box = await lastCard.boundingBox();
      expect((await add.boundingBox())!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
      await page.mouse.move(0, 0);
      await lastCard.focus();
      await page.keyboard.press('Tab');
      await expect(add).toBeFocused();
      await expect(add).toHaveCSS('opacity', '1');
    } else {
      expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await add.focus();
    }
    await expectUncovered(page, add);
    await page.screenshot({
      path: `.runtime/calendar-navigation/${info.project.name}-${theme}-add.png`,
    });
    const scroll = await page.evaluate(() => scrollY);
    for (const kind of ['Workout', 'Note', 'Event', 'Injury constraint']) {
      await add.press('Enter');
      const chooser = page.getByRole('dialog', { name: /^Add to / });
      await expect(chooser).toBeVisible();
      await chooser.getByRole('button', { name: kind, exact: true }).click();
      const editor = page.getByRole('dialog').last();
      await expect(
        editor.getByLabel(
          kind === 'Workout' || kind === 'Note'
            ? 'Scheduled date'
            : kind === 'Event'
              ? 'Date'
              : 'Start date',
          { exact: true },
        ),
      ).toHaveValue('2030-01-14');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(add).toBeFocused();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
    }
    await add.press('Enter');
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
    await empty.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Workout', exact: true }).click();
    await expect(page.getByLabel('Scheduled date')).toHaveValue('2030-01-25');
    await page.keyboard.press('Escape');
    await expect(empty).toBeFocused();
    expect(writes()).toBe(0);
  });
}

test('date navigation waits for loaded ranges, retries failures and reveals Today again', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { data } = await preview(page);
  await page.locator('[data-date="2030-01-21"]').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expectUncovered(page, page.locator('[data-date="2030-01-09"]'));
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-14');
  await expectUncovered(page, page.locator('[data-date="2030-01-14"]'));
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
  await expectUncovered(page, page.locator('[data-date="2030-01-07"]'));

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/workspace?from=2030-02-11&**', async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: 'Synthetic range outage' } });
  });
  await page.getByLabel('Go to date').fill('2030-02-14');
  await expect(page.locator('.calendar-day').first()).toHaveAttribute('data-date', '2030-01-07');
  release();
  await expect(page.locator('.page-error').getByRole('alert')).toContainText(
    'Synthetic range outage',
  );
  await expect(page.locator('.page-error')).toContainText('Showing the last loaded dates');
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-07');
  await page.unroute('**/api/workspace?from=2030-02-11&**');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-02-11');
  await expectUncovered(page, page.locator('[data-date="2030-02-14"]'));
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expectUncovered(page, page.locator('[data-date="2030-01-09"]'));
  data.profile!.weekStartsOnPreference = 'sunday';
  await page.reload();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-06');
  await expect(page.locator('.calendar-weekdays span').first()).toHaveText('Sun');
  await page.getByLabel('Go to date').fill('2029-12-31');
  await expect(page.getByLabel('Go to date')).toHaveValue('2029-12-30');
  await expectUncovered(page, page.locator('[data-date="2029-12-31"]'));
  await page.getByLabel('Go to date').fill('0001-01-01');
  await expect(page.getByLabel('Go to date')).toHaveValue('2029-12-30');
  expect(errors).toEqual([]);
});
