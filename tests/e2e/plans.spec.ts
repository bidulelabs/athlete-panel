import { test, expect, type Page } from '@playwright/test';
import { plansFixture } from '../fixtures/plans';
import { trainingHistoryFixture } from '../fixtures/training-history';
import type { AuditEntry } from '@athlete-panel/contracts';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page, changes: AuditEntry[] = []) {
  const data = plansFixture();
  let writes = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) writes++;
  });
  await page.clock.setFixedTime(new Date('2030-10-29T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), state: data, changes },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.goto('/plans');
  await expect(
    page.getByRole('button', { name: 'Open Autumn endurance block', exact: true }),
  ).toBeVisible();
  return { data, writes: () => writes, errors };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const dialog of await page.getByRole('dialog').all()) {
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
  }
}

test('recent changes opens on demand with readable details in both themes', async ({
  page,
}, info) => {
  const changes = trainingHistoryFixture();
  const { writes, errors } = await preview(page, changes);
  const trigger = page.getByRole('button', { name: 'Recent changes', exact: true });
  const sheet = page.getByRole('dialog', { name: 'Recent changes', exact: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Updated Easy endurance ride', { exact: true })).toHaveCount(0);
    await trigger.click();
    await expect(sheet.getByRole('button', { name: 'Close recent changes' })).toBeFocused();
    await expect(sheet).not.toContainText('workout.update');
    await expect(sheet).toContainText('Duplicated Autumn endurance block copy');
    await expect(sheet).toContainText('Undone');
    await expect(sheet).toContainText('Undo unavailable');
    const entry = sheet.locator('.training-history-entry').first();
    await expect(entry).toContainText('1 item');
    await expect(entry).not.toContainText('2 items');
    await page.screenshot({
      path: `.runtime/plans-review/history-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
    await entry.getByRole('button', { name: 'View details' }).click();
    await expect(entry.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(entry.locator('dl')).toContainText('45m');
    await expect(entry.locator('dl')).toContainText('After: 1h');
    await expect(entry).toContainText('Extend the ride only if recovery feels good.');
    await expect(entry).not.toContainText('Revision');
    await noOverflow(page);
    await page.screenshot({
      path: `.runtime/plans-review/history-details-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 320, height: 740 });
  changes[0].changes.find((change) => change.entity === 'workout')!.after!.title =
    'A long workout title '.repeat(12);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await trigger.click();
  await sheet.getByRole('button', { name: 'View details' }).first().click();
  await noOverflow(page);
  await expect(sheet.getByRole('button', { name: 'Close recent changes' })).toBeInViewport();
  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: 'Close recent changes' }).click();
  changes.splice(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await trigger.click();
  await expect(sheet).toContainText('No changes yet');
  await expect(sheet.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect(writes()).toBe(0);
  expect(errors).toEqual([]);
});

test('history undo confirms, preserves the sheet on cancel or conflict and marks success', async ({
  page,
}) => {
  const changes = trainingHistoryFixture();
  const { writes, errors } = await preview(page, changes);
  const trigger = page.getByRole('button', { name: 'Recent changes', exact: true });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Recent changes', exact: true });
  const entry = sheet.locator('.training-history-entry').first();
  const undo = entry.getByRole('button', { name: 'Undo', exact: true });
  const confirmation = page.getByRole('alertdialog');
  await undo.click();
  await expect(confirmation).toContainText('Undo “Updated Easy endurance ride”?');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(undo).toBeFocused();
  expect(writes()).toBe(0);
  let attempts = 0;
  await page.route('**/api/plugins/training/undo', async (route) => {
    attempts++;
    const body = route.request().postDataJSON();
    expect(body.id).toBe(changes[0].id);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'undo_conflict',
            message: 'A later edit prevents restoring the whole change. No records were changed.',
          },
        },
      });
    changes[0].undoneAt = '2030-10-29T12:00:00Z';
    await route.fulfill({ json: { id: crypto.randomUUID(), changes: [] } });
  });
  await undo.click();
  await confirmation.getByRole('button', { name: 'Undo change' }).click();
  await expect(
    sheet.getByText('A later edit prevents restoring the whole change. No records were changed.'),
  ).toBeInViewport();
  await expect(undo).toBeEnabled();
  await expect(sheet).toBeVisible();
  await undo.click();
  await confirmation.getByRole('button', { name: 'Undo change' }).click();
  await expect(entry).toContainText('Undone');
  await expect(undo).toHaveCount(0);
  await expect(sheet).toBeVisible();
  expect(writes()).toBe(2);
  expect(errors).toEqual([]);
  await sheet.getByRole('button', { name: 'Close recent changes' }).click();
  await expect(trigger).toBeFocused();
});

test('multiple plans, readable descriptions and ordered weeks in both themes', async ({
  page,
}, info) => {
  const { writes, errors } = await preview(page);
  const trigger = page.getByRole('button', { name: 'Open Autumn endurance block', exact: true });
  const plan = page.getByRole('dialog', { name: 'Autumn endurance block', exact: true });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.locator('.plans-list-row')).toHaveCount(3);
    await expect(page.locator('.plans-list')).not.toContainText('known');
    await expect(page.locator('.plans-list')).not.toContainText('without duration');
    await expect(
      page.getByRole('button', { name: 'Open Spring 10 km preparation', exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Open Threshold intervals', exact: true }),
    ).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: `.runtime/plans-review/overview-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
    await trigger.click();
    await expect(plan.getByRole('heading', { name: 'Autumn endurance block' })).toBeFocused();
    await expect(plan.getByRole('region', { name: 'Plan description' })).toContainText(
      'The first week establishes consistency.',
    );
    const weeks = plan.locator('.plans-week');
    await expect(weeks).toHaveCount(2);
    await expect(weeks.first()).toContainText('21 Oct – 27 Oct 2030');
    const day2 = weeks.first().locator('.plans-day').filter({ hasText: 'Day 2' });
    await expect(day2.locator('.plans-session-open')).toHaveText([
      /Threshold intervals.*1h 15m.*32.0 km.*3 × 10 min · 220–245 W/,
      /Strength & stability.*30m.*2 exercises/,
    ]);
    await expect(
      plan.getByRole('button', { name: 'Open Rest and reset', exact: true }),
    ).toContainText('Rest day');
    await expect(
      plan.getByRole('button', { name: 'Open Recovery spin', exact: true }),
    ).toContainText('Duration not set');
    await expect(plan.locator('.plans-overview > .plans-meta')).not.toContainText('duration');
    await expect(plan.locator('.plans-overview > .plans-meta')).not.toContainText('known');
    await noOverflow(page);
    await page.screenshot({
      path: `.runtime/plans-review/detail-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
    await plan
      .getByRole('heading', { name: 'Workouts', exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: `.runtime/plans-review/workouts-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
    await plan.getByRole('button', { name: 'Close training plan' }).click();
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: 'Open Winter strength & mobility' }).click();
  await expect(page.getByRole('dialog')).toContainText('Unscheduled');
  await expect(page.getByRole('dialog')).toContainText('Days 1–7');
  await expect(page.getByRole('dialog')).toContainText('Duration not set');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Spring 10 km preparation' }).click();
  await expect(page.getByRole('button', { name: 'Add first workout' })).toBeVisible();
  expect(writes()).toBe(0);
  expect(errors).toEqual([]);
});

test('workout opens full inspector, nested edit and logging preserve focus and drafts', async ({
  page,
}, info) => {
  const { data, writes, errors } = await preview(page);
  data.profile!.units = 'imperial';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Open Autumn endurance block' }).click();
  const plan = page.getByRole('dialog', { name: 'Autumn endurance block', exact: true });
  const row = plan.getByRole('button', { name: 'Open Threshold intervals', exact: true });
  await expect(row).toContainText('19.9 mi');
  const tempo = plan.getByRole('button', { name: 'Open Tempo ride', exact: true });
  await expect(tempo).toContainText('1.0 mi · RPE 4 / 10');
  await expect(tempo).not.toContainText('3 ×');
  await row.click();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  await expect(page.getByRole('dialog', { name: 'Workout details', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Edit workout', exact: true })).toHaveCount(0);
  const prescription = inspector.getByRole('region', { name: 'Workout prescription' });
  for (const value of [
    'Warm up',
    '110–130 bpm',
    'Repeat 3 times',
    '220–245 W',
    'Smooth cadence.',
    'RPE 2 / 10',
    '1.0 mi',
    '8:03–8:51 / mi',
  ])
    await expect(prescription).toContainText(value);
  await expect(inspector.getByRole('button', { name: 'Close workout details' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(
      () =>
        Boolean(document.activeElement?.closest('.inspector-frame')) ||
        document.activeElement === document.body,
    ),
  ).toBe(true);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: `.runtime/plans-review/inspector-${info.project.name}-${theme}.png`,
      animations: 'disabled',
      scale: 'css',
    });
  }
  for (const [label, confirmation] of [
    ['Duplicate', 'Duplicate workout'],
    ['Delete workout', 'Delete workout'],
  ]) {
    const trigger = inspector.getByRole('button', { name: label, exact: true });
    await trigger.click();
    const popup = page.getByRole('alertdialog');
    await expect(popup.getByRole('button', { name: confirmation, exact: true })).toBeVisible();
    await expect(popup).toContainText('Threshold intervals');
    await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(writes()).toBe(0);
  }
  await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await editor.getByLabel('Workout description').fill('Keep this unsaved draft.');
  await page.setViewportSize({ width: info.project.name === 'desktop' ? 390 : 1440, height: 900 });
  await expect(editor.getByLabel('Workout description')).toHaveValue('Keep this unsaved draft.');
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(inspector.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await inspector.getByRole('button', { name: 'Log workout', exact: true }).click();
  const completion = page.getByRole('dialog', { name: 'Log completion' });
  await completion.getByRole('button', { name: 'Close dialog' }).focus();
  await expect(completion.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inspector.getByRole('button', { name: 'Log workout', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Edit Threshold intervals', exact: true }).click();
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    plan.getByRole('button', { name: 'Edit Threshold intervals', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open Autumn endurance block' })).toBeFocused();
  expect(writes()).toBe(0);
  expect(errors).toEqual([]);
});

test('plan actions keep failed drafts, confirm duplication/deletion and use current revisions', async ({
  page,
}, info) => {
  const { data } = await preview(page);
  await page.getByRole('button', { name: 'Open Autumn endurance block' }).click();
  const plan = page.getByRole('dialog', { name: 'Autumn endurance block', exact: true });
  await plan.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit training plan', exact: true });
  await editor.getByLabel('Description').fill('Unsaved plan description.');
  await page.route('**/api/plugins/training/mutate', (route) =>
    route.fulfill({
      status: 409,
      json: { error: 'This plan changed. Refresh and review before saving.' },
    }),
  );
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.getByLabel('Description')).toHaveValue('Unsaved plan description.');
  await page.keyboard.press('Escape');
  await expect(plan.getByRole('button', { name: 'Edit plan', exact: true })).toBeFocused();
  await plan.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('and its planned sessions');
  await page.keyboard.press('Escape');
  await expect(plan.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  data.plans[0]!.revision = 4;
  const commands: { action: string; expectedRevision: number }[] = [];
  await page.route('**/api/plugins/training/mutate', async (route) => {
    commands.push(...route.request().postDataJSON().commands);
    await route.fulfill({ json: { id: crypto.randomUUID(), changes: [] } });
  });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const action of ['Duplicate', 'Delete']) {
      const trigger = plan.getByRole('button', { name: action, exact: true });
      await trigger.click();
      await expect(
        confirm.getByRole('button', { name: `${action} plan`, exact: true }),
      ).toBeVisible();
      await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await expect(confirm).toContainText('Autumn endurance block');
      if (action === 'Duplicate') await expect(confirm).toContainText('unscheduled');
      await page.screenshot({
        path: `.runtime/plans-review/confirm-${action.toLowerCase()}-${info.project.name}-${theme}.png`,
        animations: 'disabled',
        scale: 'css',
      });
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(commands).toHaveLength(0);
    }
  }
  await plan.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await confirm.getByRole('button', { name: 'Duplicate plan', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  // The successful request refreshes the open plan to the next revision.
  await expect(plan.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
  await plan.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await confirm.getByRole('button', { name: 'Duplicate plan', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({ action: 'plan.duplicate', expectedRevision: 4 });
  await expect(plan.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  await plan.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirm.getByRole('button', { name: 'Delete plan', exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2]).toMatchObject({ action: 'plan.delete', expectedRevision: 4 });
  await expect(plan).not.toBeVisible();
});

test('long content, narrow layouts and empty plans remain usable', async ({ page }, info) => {
  const { data, writes, errors } = await preview(page);
  const title =
    'A long training plan with an unbroken reference abcdefghijklmnopqrstuvwxyz0123456789';
  data.plans[0]!.title = title;
  data.plans[0]!.description = 'Keep the effort conversational.\n\n'.repeat(100);
  data.workouts[0]!.title = 'Long workout abcdefghijklmnopqrstuvwxyz0123456789';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  const plan = page.getByRole('dialog', { name: title, exact: true });
  for (const width of info.project.name === 'mobile' ? [320, 390, 768] : [1060, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 768 ? 390 : 900 });
    await plan.getByRole('button', { name: 'Open Threshold intervals' }).scrollIntoViewIfNeeded();
    await noOverflow(page);
    await expect(plan.getByRole('button', { name: 'Close training plan' })).toBeInViewport();
    for (const control of [
      plan.getByRole('button', { name: 'Close training plan' }),
      plan.getByRole('button', { name: 'Edit Threshold intervals' }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  }
  await page.keyboard.press('Escape');
  data.plans = [];
  data.workouts = [];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create your first plan' })).toBeVisible();
  expect(writes()).toBe(0);
  expect(errors).toEqual([]);
});
