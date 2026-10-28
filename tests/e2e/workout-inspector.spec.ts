import { test, expect, type Page } from '@playwright/test';
import { workoutSchema } from '@athlete-panel/contracts';
import { weeklyFixture } from '../fixtures/weekly';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page) {
  const data = weeklyFixture();
  data.workouts[3] = workoutSchema.parse({
    ...data.workouts[3],
    title: 'Threshold intervals',
    durationSeconds: 4500,
    steps: [
      {
        kind: 'warmup',
        durationSeconds: 900,
        target: { kind: 'heartRateBpm', min: 110, max: 130 },
      },
      {
        kind: 'repeat',
        times: 3,
        steps: [
          {
            kind: 'work',
            durationSeconds: 600,
            target: { kind: 'powerWatts', min: 220, max: 245 },
            notes: 'Keep a smooth cadence.\nEase into each effort.',
          },
          { kind: 'recovery', durationSeconds: 300, target: { kind: 'rpe', min: 2, max: 2 } },
        ],
      },
      {
        kind: 'cooldown',
        distanceMeters: 1609.344,
        target: { kind: 'paceSecondsPerKilometer', min: 300, max: 330 },
      },
    ],
  });
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) writes++;
  });
  await page.clock.setFixedTime(new Date('2030-01-09T12:00:00Z'));
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state: data } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.getByLabel('Go to date').fill('2030-01-07');
  return { data, writes: () => writes };
}

test('read-only prescription retains repeat structure, all targets, notes and display units', async ({
  page,
}, info) => {
  const { data, writes } = await preview(page);
  const trigger = page.getByRole('button', { name: 'Open Threshold intervals', exact: true });
  await trigger.click();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  const prescription = inspector.getByRole('region', { name: 'Workout prescription' });
  if (info.project.name === 'desktop') await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const value of [
    'Warm up',
    '15 min',
    '110–130 bpm',
    'Repeat 3 times',
    '10 min',
    '220–245 W',
    '5 min',
    'RPE 2 / 10',
    '1.6 km',
    '5:00–5:30 / km',
  ]) {
    await expect(prescription).toContainText(value);
  }
  await expect(
    prescription.getByText('Keep a smooth cadence. Ease into each effort.'),
  ).toBeVisible();
  await expect(prescription.getByText('Work', { exact: true })).toHaveCount(1);
  await expect(inspector.getByRole('button', { name: 'Log workout', exact: true })).toBeVisible();
  await page.screenshot({
    path: `.runtime/design-review/after-${info.project.name}-dark.png`,
    animations: 'disabled',
  });
  await inspector.getByRole('button', { name: 'Close workout details' }).click();
  await expect(trigger).toBeFocused();
  data.profile!.units = 'imperial';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page
    .getByRole('button', {
      name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
      exact: true,
    })
    .click();
  await trigger.click();
  await expect(prescription).toContainText('1.0 mi');
  await expect(prescription).toContainText('8:03–8:51 / mi');
  await page.screenshot({
    path: `.runtime/design-review/after-${info.project.name}-light.png`,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes()).toBe(0);
});

test('overlay contains keyboard focus, closes one layer at a time, and preserves an editor across resizing', async ({
  page,
}, info) => {
  const { writes } = await preview(page);
  const trigger = page.getByRole('button', { name: 'Open Threshold intervals', exact: true });
  await trigger.click();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  const close = inspector.getByRole('button', { name: 'Close workout details' });
  await expect(close).toBeFocused();
  if (info.project.name === 'mobile') {
    await expect(page.getByRole('dialog', { name: 'Workout details', exact: true })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    // The shared Sheet keeps keyboard focus inside the inspector.
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest('.inspector-frame')),
      ),
    ).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await inspector.getByRole('button', { name: 'Delete workout', exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest('.inspector-frame')),
      ),
    ).toBe(true);
    for (const button of [
      close,
      inspector.getByRole('button', { name: 'Log workout', exact: true }),
    ]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await inspector.getByRole('button', { name: 'Log workout', exact: true }).click();
  const completion = page.getByRole('dialog', { name: 'Log completion', exact: true });
  await expect(completion.getByRole('radio', { name: 'Completed', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  if (info.project.name === 'mobile') {
    await expect
      .poll(
        async () =>
          (await completion.getByRole('radio', { name: 'Completed', exact: true }).boundingBox())!
            .height,
      )
      .toBeGreaterThanOrEqual(44);
  }
  await completion.getByRole('radio', { name: 'Partial', exact: true }).click();
  await expect(completion.getByRole('radio', { name: 'Partial', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(completion).not.toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Log workout', exact: true })).toBeFocused();
  await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await editor.getByLabel('Workout notes').fill('An unsaved draft must survive a viewport change.');
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 1440 : 390, height: 844 });
  await expect(editor.getByLabel('Workout notes')).toHaveValue(
    'An unsaved draft must survive a viewport change.',
  );
  expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(editor).not.toBeVisible();
  await expect(inspector).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.inspector-frame')
        .evaluate((element) => element.getAttribute('data-overlay') === 'true'),
    )
    .toBe(info.project.name === 'desktop');
  await expect(inspector.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inspector).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.locator('body').evaluate((element) => element.style.overflow)).not.toBe(
    'hidden',
  );
  expect(writes()).toBe(0);
});

test('long details reflow at narrow and landscape widths while close and logging stay reachable', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'mobile',
    'Responsive content check runs once with touch emulation.',
  );
  const { data } = await preview(page);
  data.workouts[3]!.title =
    'A very long session title with an unbroken reference abcdefghijklmnopqrstuvwxyz0123456789';
  data.workouts[3]!.notes = 'Review one interval at a time.\n'.repeat(60);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 640 });
  const add = page.getByRole('button', { name: 'Add to 7 Jan', exact: true });
  const box = await add.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: `Open ${data.workouts[3]!.title}`, exact: true }).tap();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: width === 768 ? 390 : 640 });
    await inspector
      .getByRole('button', { name: 'Delete workout', exact: true })
      .scrollIntoViewIfNeeded();
    expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(inspector.getByRole('button', { name: 'Close workout details' })).toBeInViewport();
    await expect(
      inspector.getByRole('button', { name: 'Log workout', exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `.runtime/design-review/after-long-${width}.png`,
      animations: 'disabled',
    });
  }
  await inspector.getByRole('button', { name: 'Log workout', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Log completion', exact: true })).toBeVisible();
});

test('calendar stays compact on desktop with usable phone cards', async ({ page }, info) => {
  const { writes } = await preview(page);
  await expect(page.getByRole('group', { name: 'Calendar layout' })).toHaveCount(0);
  await expect(page.locator('.calendar-day')).toHaveCount(21);
  const trigger = page.getByRole('button', { name: 'Open Threshold intervals', exact: true });
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  if (info.project.name === 'desktop') {
    await trigger.click();
    for (const width of [1060, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const days = page.locator('.calendar-week').first().locator('.calendar-day');
      const first = await days.first().boundingBox();
      const last = await days.last().boundingBox();
      expect(last!.x).toBeGreaterThan(first!.x);
      expect(last!.y).toBeCloseTo(first!.y, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(inspector).toHaveCount(1);
      await expect(trigger).toHaveClass(/selected/);
      await expect(
        inspector.getByRole('button', { name: 'Log workout', exact: true }),
      ).toBeVisible();
    }
  }
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.screenshot({
      path: `.runtime/design-review/compact-only-${info.project.name}-${theme}.png`,
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 });
    const card = await trigger.boundingBox();
    expect(card!.width).toBeGreaterThan(200);
    for (const control of [
      page.getByRole('button', { name: 'Add workout', exact: true }),
      page.getByRole('button', { name: 'Add to 7 Jan', exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await trigger.tap();
    await expect(page.getByRole('dialog', { name: 'Workout details', exact: true })).toHaveCount(1);
    await inspector.getByRole('button', { name: 'Log workout', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Log completion', exact: true })).toBeVisible();
  }
  expect(writes()).toBe(0);
});

test('a save finishing after a week change reloads the new week', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'The phone inspector is modal.');
  await preview(page);
  let releaseSave: () => void = () => undefined;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/plugins/training/mutate', async (route) => {
    await heldSave;
    await route.fulfill({ json: { id: crypto.randomUUID(), changes: [] } });
  });
  await page.getByRole('button', { name: 'Open Short easy run', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  await inspector.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const nextWeekLoaded = page.waitForResponse((response) =>
    response.url().includes('/api/workspace?from=2030-01-14'),
  );
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await nextWeekLoaded;
  const reload = page.waitForResponse(
    (response) =>
      response.url().includes('/api/workspace?') && response.request().method() === 'GET',
  );
  releaseSave();
  expect(new URL((await reload).url()).searchParams.get('from')).toBe('2030-01-14');
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-14');
});
