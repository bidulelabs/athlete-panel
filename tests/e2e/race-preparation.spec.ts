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
const openPreparation = (page: Page) =>
  page.getByRole('tab', { name: 'Preparation', exact: true }).click();
const save = (page: Page) =>
  page.getByRole('button', { name: 'Save preparation', exact: true }).click();
const needsReview = (page: Page) => page.getByText(/changed after this strategy was written/);

for (const theme of ['light', 'dark']) {
  test(`write a race plan by hand and review it after a new course (${theme})`, async ({
    page,
    baseURL,
  }, info) => {
    await signIn(page, theme);
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await page.getByRole('tab', { name: 'Course', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Preparation', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(/Upload the course GPX in the Course tab/)).toBeVisible();
    await page.getByLabel('Target', { exact: true }).fill('Finish comfortably');
    await save(page);
    await expect(page.getByText('Preparation saved.')).toBeVisible();

    await uploadCourse(page, syntheticGpx());
    await openPreparation(page);
    await expect(page.getByLabel('Target', { exact: true })).toHaveValue('Finish comfortably');
    await expect(needsReview(page)).toHaveCount(0);
    const firstSection = page.locator('.race-pacing input').first();
    await firstSection.fill('Easy, walk the steep ramps');
    await page.getByLabel(/^Briefing/).fill('Start easy, keep the climb steady.');
    await page.getByLabel(/^Open questions/).fill('Poles allowed?\nDrop bag?');
    await save(page);
    await expect(page.getByText('Preparation saved.')).toBeVisible();
    await expect(needsReview(page)).toHaveCount(0);

    await page.reload();
    await openPreparation(page);
    await expect(firstSection).toHaveValue('Easy, walk the steep ramps');
    await expect(page.getByLabel(/^Open questions/)).toHaveValue('Poles allowed?\nDrop bag?');
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await uploadCourse(page, syntheticGpx({ km: 30, salt: 'replacement' }), true);
    await openPreparation(page);
    await expect(needsReview(page)).toBeVisible();
    await expect(page.getByLabel(/^Briefing/)).toHaveValue('Start easy, keep the climb steady.');
    await page.getByLabel(/^Briefing/).fill('Start easy, push on the last climb.');
    await expect(page.getByRole('button', { name: 'Mark as reviewed', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText('Save your changes before marking the plan as reviewed.'),
    ).toBeVisible();
    await save(page);
    await expect(needsReview(page)).toHaveCount(0);
    await expect(page.getByLabel(/^Briefing/)).toHaveValue('Start easy, push on the last climb.');

    await page.getByLabel('Target', { exact: true }).fill('Under 8 hours');
    await save(page);
    await expect(needsReview(page)).toBeVisible();
    await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
    await expect(needsReview(page)).toHaveCount(0);
    await expect(page.getByLabel('Target', { exact: true })).toHaveValue('Under 8 hours');
  });
}

test('refuses a save over a plan changed elsewhere, then reloads it', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  const racePlanId = randomUUID();
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { id: racePlanId, eventId: raceId, target: 'Finish comfortably' },
  });
  await page.goto(`/races?race=${raceId}`);
  await openPreparation(page);
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('Finish comfortably');
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision: 1,
    values: { target: 'Under 8 hours' },
  });
  await page.getByLabel(/^Briefing/).fill('My draft');
  await save(page);
  await expect(page.getByText('Preparation saved.')).toHaveCount(0);
  const reload = page.getByRole('button', { name: 'Reload saved data', exact: true });
  await reload.click();
  await expect(page.getByLabel(/^Briefing/)).toHaveValue('My draft');
  await save(page);
  await expect(reload).toBeVisible();
  await expect(page.getByText('Preparation saved.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use saved plan', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('Under 8 hours');
  await expect(page.getByLabel(/^Briefing/)).toHaveValue('');
});

test('keeps the draft when another tab created the plan first', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await openPreparation(page);
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { id: randomUUID(), eventId: raceId, target: 'Under 8 hours' },
  });
  await page.getByLabel(/^Briefing/).fill('My draft');
  await save(page);
  await expect(page.getByText(/This race already has a plan/)).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(page.getByLabel(/^Briefing/)).toHaveValue('My draft');
  await page.getByRole('button', { name: 'Use saved plan', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('Under 8 hours');
});
