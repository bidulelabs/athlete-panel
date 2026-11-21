import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { syntheticGpx } from '../fixtures/race-analysis';
import {
  addReferences,
  createRace,
  ownerCommand,
  setNutrition,
  signIn,
  uploadCourse,
} from './race-helpers';

const openNutrition = (page: Page) =>
  page.getByRole('tab', { name: 'Nutrition', exact: true }).click();
const targetFact = (page: Page, label: string) =>
  page
    .locator('.race-nutrition-targets > div')
    .filter({ has: page.getByText(label, { exact: true }) });
const reviewNotice = (page: Page) =>
  page.getByText(
    'The course or your target changed after this plan was written. Check that the nutrition plan still holds.',
    { exact: true },
  );

for (const theme of ['light', 'dark']) {
  test(`set nutrition targets and phase texts by keyboard (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page, theme);
    await setNutrition(page, baseURL!, { preferences: 'Vegetarian.\nNo lactose before running.' });
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await uploadCourse(page, syntheticGpx());
    await page.getByRole('tab', { name: 'Race day', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Nutrition', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Your plan, not a prescription', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'During the race', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('No hourly targets yet', { exact: true })).toBeVisible();
    await expect(page.locator('.race-nutrition-targets')).toHaveCount(0);
    await expect(page.locator('summary')).toContainText('From Settings · Vegetarian.');

    await page.getByRole('button', { name: 'Set targets', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Carbohydrate · g per hour', { exact: true }).fill('60');
    await dialog.getByLabel('Fluid · ml per hour', { exact: true }).fill('0');
    await dialog.getByLabel('Carbohydrate · g per hour', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(targetFact(page, 'Carbohydrate')).toContainText('60 g');
    await expect(targetFact(page, 'Fluid')).toContainText('0 ml');
    await expect(targetFact(page, 'Sodium')).toContainText('unknown');

    await page.getByRole('tab', { name: 'During the race', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Breakfast', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Nothing written yet.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit breakfast', exact: true }).click();
    await dialog.getByLabel('What you plan', { exact: true }).fill('04:00 · oats and a banana.');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByText('Your preferences', { exact: true }).click();
    await expect(
      page.getByText('Vegetarian. No lactose before running.', { exact: true }),
    ).toBeVisible();

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize(viewport);

    await page.reload();
    await openNutrition(page);
    await expect(targetFact(page, 'Carbohydrate')).toContainText('60 g');
    await page.getByRole('tab', { name: 'Breakfast', exact: true }).click();
    await expect(page.getByText('04:00 · oats and a banana.', { exact: true })).toBeVisible();

    await uploadCourse(page, syntheticGpx({ km: 30, salt: 'replacement' }), true);
    await openNutrition(page);
    await expect(reviewNotice(page)).toBeVisible();
    await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
    await expect(reviewNotice(page)).toHaveCount(0);
  });
}

test('keeps the targets draft when the plan changed elsewhere, then saves it after a reload', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  await setNutrition(page, baseURL!, { preferences: '' });
  const raceId = await createRace(page, baseURL!);
  const racePlanId = randomUUID();
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { id: racePlanId, eventId: raceId, target: 'Finish comfortably' },
  });
  await page.goto(`/races?race=${raceId}`);
  await openNutrition(page);
  await page.getByText('Your preferences', { exact: true }).click();
  await expect(page.getByText('No preferences in Settings yet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set targets', exact: true }).click();
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision: 1,
    values: { startTime: '06:30' },
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sodium · mg per hour', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByText(/Use Reload saved data to review the saved version/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(
    dialog.getByText('Saved data reloaded. Review it before saving again.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Sodium · mg per hour', { exact: true })).toHaveValue('500');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(targetFact(page, 'Sodium')).toContainText('500 mg');
  await page.getByRole('tab', { name: 'Race day', exact: true }).click();
  await expect(page.locator('.race-day-start')).toContainText('Start 06:30');
});

const product = (name: string, values: Record<string, unknown>) => ({
  id: randomUUID(),
  name,
  kind: 'gel',
  carbohydrateGrams: null,
  fluidMillilitres: null,
  sodiumMilligrams: null,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'untested',
  ...values,
});
const scheduleRows = (page: Page) => page.locator('.race-nutrition-schedule tbody tr');

for (const theme of ['light', 'dark']) {
  test(`plan products and cues during the race by keyboard (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page, theme);
    const gel = product('Citrus gel', {
      carbohydrateGrams: 25,
      sodiumMilligrams: 50,
      tolerance: 'comfortable',
    });
    const crackers = product('Salted crackers', { kind: 'food', sodiumMilligrams: 300 });
    await setNutrition(page, baseURL!, { products: [gel, crackers] });
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await uploadCourse(page, syntheticGpx());
    await addReferences(page, baseURL!, raceId);
    await page.reload();
    await openNutrition(page);
    await expect(
      page.getByText('Nothing planned during the race yet.', { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Set targets', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Carbohydrate · g per hour', { exact: true }).fill('60');
    await dialog.getByLabel('Sodium · mg per hour', { exact: true }).fill('500');
    await dialog.getByLabel('Carbohydrate · g per hour', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit plan', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
    const second = dialog.getByRole('group', { name: 'Product 2', exact: true });
    await second.getByRole('combobox').selectOption({ label: 'Salted crackers' });
    await second.getByLabel('Every (minutes)', { exact: true }).fill('60');
    await dialog.getByRole('button', { name: 'Add cue', exact: true }).click();
    await expect(dialog.getByLabel('When', { exact: true })).toBeFocused();
    await dialog.getByLabel('When', { exact: true }).fill('Long climbs');
    await dialog.getByLabel('What to do', { exact: true }).fill('Eat on the gentler approach');
    await dialog.getByLabel('What to do', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);

    await expect(scheduleRows(page)).toHaveCount(3);
    await expect(scheduleRows(page).nth(0)).toContainText('Every 30 min');
    await expect(scheduleRows(page).nth(0)).toHaveText(
      'Every 30 min1 × Citrus gel25 g carbohydrate · 50 mg sodiumComfortable',
    );
    await expect(scheduleRows(page).nth(1)).toHaveText(
      'Every hour1 × Salted crackers300 mg sodiumNot tested',
    );
    await expect(scheduleRows(page).nth(2)).toHaveText('Long climbsEat on the gentler approach');
    await expect(page.getByRole('status').filter({ hasText: 'Not counted' })).toHaveText(
      'Not counted in the hourly totalsCitrus gel (no fluid value), Salted crackers (no carbohydrate or fluid value). Add the label values in Settings to count them.',
    );
    await expect(targetFact(page, 'Carbohydrate')).toContainText(
      '60 gper hour moving, planned 50 g, 17% below',
    );
    await expect(targetFact(page, 'Fluid')).toContainText('unknownper hour, planned unknown');
    await expect(targetFact(page, 'Sodium')).toContainText(
      '500 mgper hour, planned 400 mg, 20% below',
    );
    await expect(page.locator('.race-nutrition-total')).toHaveText(
      /^About \d+ g carbohydrate over \d+h \d\dm moving\.$/,
    );

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize(viewport);

    await setNutrition(page, baseURL!, { products: [gel] });
    await page.reload();
    await openNutrition(page);
    await expect(
      page.getByText('A product of this plan was removed from Settings', { exact: true }),
    ).toBeVisible();
    await expect(scheduleRows(page).nth(1)).toHaveText('Every hour1 × Removed product');
    await expect(targetFact(page, 'Sodium')).toContainText('planned 100 mg, 80% below');
    await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove product 2', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Add product', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(scheduleRows(page)).toHaveCount(2);
    await expect(
      page.getByText('A product of this plan was removed from Settings', { exact: true }),
    ).toHaveCount(0);
  });
}

test('points to Settings when the profile has no product', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  await setNutrition(page, baseURL!, { products: [] });
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await openNutrition(page);
  await expect(page.getByRole('heading', { name: 'Add the products you use' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Add products in Settings, then Nutrition, to plan them here.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Add cue', exact: true }).click();
  await dialog.getByLabel('When', { exact: true }).fill('At stations');
  const whatToDo = dialog.getByLabel('What to do', { exact: true });
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(await whatToDo.evaluate((field: HTMLInputElement) => field.validity.valueMissing)).toBe(
    true,
  );
  await whatToDo.fill('   ');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(await whatToDo.evaluate((field: HTMLInputElement) => field.validity.patternMismatch)).toBe(
    true,
  );
  await expect(dialog).toBeVisible();
  await whatToDo.fill('Station food replaces a planned gel');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Station food replaces a planned gel', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.race-nutrition-total')).toHaveCount(0);
});
