import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { courseRace, syntheticGpx } from '../fixtures/race-analysis';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');

async function signIn(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function ownerCommand(page: Page, baseURL: string, command: Record<string, unknown>) {
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: baseURL },
    data: { idempotencyKey: randomUUID(), commands: [command] },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function setPreferences(page: Page, baseURL: string, preferences: string) {
  const workspace = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  const profile = (await workspace.json()).state.profile;
  await ownerCommand(page, baseURL, {
    action: 'profile.set',
    expectedRevision: profile?.revision ?? null,
    values: { nutrition: { products: [], carryCapacityMillilitres: null, preferences } },
  });
}
async function createRace(page: Page, baseURL: string) {
  const { title, date, kind, notes } = courseRace();
  const id = randomUUID();
  await ownerCommand(page, baseURL, {
    action: 'event.create',
    values: { id, title, date, kind, notes },
  });
  return id;
}
async function uploadCourse(page: Page, xml: string, replacing = false) {
  await page.getByRole('tab', { name: 'Course', exact: true }).click();
  await page
    .getByRole('button', { name: replacing ? 'Replace GPX' : 'Upload GPX', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('GPX course file', { exact: true }).setInputFiles({
    name: 'alpine-trail-42.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(xml),
  });
  await dialog.getByRole('button', { name: 'Use this course', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
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
    await setPreferences(page, baseURL!, 'Vegetarian.\nNo lactose before running.');
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
  await setPreferences(page, baseURL!, '');
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
