import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { emptyWorkspace, type RaceAnalysis } from '@athlete-panel/contracts';
import { courseRace, courseReferences, syntheticGpx } from '../fixtures/race-analysis';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');
const endpoint = '/api/plugins/race-analysis/';

async function signIn(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function createRace(page: Page, baseURL: string) {
  const race = { ...courseRace(), id: randomUUID() };
  const values = {
    id: race.id,
    title: race.title,
    date: race.date,
    kind: race.kind,
    notes: race.notes,
  };
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: baseURL },
    data: { idempotencyKey: randomUUID(), commands: [{ action: 'event.create', values }] },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return race.id;
}
async function readAnalysis(page: Page, baseURL: string, raceId: string): Promise<RaceAnalysis> {
  const response = await page.request.post(endpoint + 'analysis', {
    headers: { Origin: baseURL },
    data: { raceId },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function uploadCourse(page: Page, xml: string, replacing = false) {
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
}
async function addReferences(page: Page, baseURL: string, raceId: string) {
  let value = await readAnalysis(page, baseURL, raceId);
  for (const ref of courseReferences) {
    const response = await page.request.post(endpoint + 'uploads/track', {
      headers: { Origin: baseURL },
      multipart: {
        file: {
          name: ref.title + '.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(syntheticGpx(ref)),
        },
        metadata: JSON.stringify({
          raceId,
          purpose: 'reference',
          title: ref.title,
          terrain: 3,
          durationSeconds: null,
          expectedRevision: value.revision,
          idempotencyKey: randomUUID(),
        }),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    value = await readAnalysis(page, baseURL, raceId);
  }
}

for (const theme of ['light', 'dark']) {
  test(`upload, inspect, save terrain and review evidence (${theme})`, async ({
    page,
    baseURL,
  }, info) => {
    await signIn(page, theme);
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await expect(page.getByText('See what the course asks of you')).toBeVisible();
    await uploadCourse(page, syntheticGpx());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('3 more usable past efforts', { exact: false })).toBeVisible();
    await addReferences(page, baseURL!, raceId);
    await page.reload();
    await expect(page.locator('.race-finish')).toContainText(/h/);
    await expect(page.getByText(/Planning range/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Slope bands' }).getByRole('listitem')).toHaveCount(
      5,
    );
    const slider = page.getByRole('slider', { name: 'Course position' });
    const marker = page.getByTestId('route-selection');
    const before = await marker.getAttribute('cx');
    await slider.focus();
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1');
    expect(await marker.getAttribute('cx')).not.toBe(before);
    await expect(page.getByTestId('profile-selection')).not.toHaveText(/^0 km/);
    const route = page.getByRole('img', { name: /^Course route\. Use/ });
    const box = (await route.boundingBox())!;
    const position = { x: box.width / 2, y: box.height * 0.85 };
    if (info.project.name === 'mobile') await route.tap({ position });
    else await route.click({ position });
    expect(Number(await slider.inputValue())).toBeGreaterThan(100);
    await expect(page.getByTestId('profile-selection')).not.toHaveText(/^0\.0 km/);
    const routePosition = await slider.inputValue();
    const profile = page.locator('.race-elevation-chart .recharts-wrapper');
    const profileBox = (await profile.boundingBox())!;
    const profilePosition = { x: profileBox.width * 0.8, y: profileBox.height / 2 };
    if (info.project.name === 'mobile') await profile.tap({ position: profilePosition });
    else await profile.click({ position: profilePosition });
    await expect(slider).not.toHaveValue(routePosition);
    await page.getByText('Section by section', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Section 1 terrain', exact: true }).selectOption('5');
    await expect(page.getByText('Preview · unsaved terrain')).toBeVisible();
    await page.getByRole('button', { name: 'Save terrain', exact: true }).click();
    await expect(page.getByText('Terrain saved. Estimate updated.')).toBeVisible();
    await page.reload();
    await page.getByText('Section by section', { exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Section 1 terrain', exact: true }),
    ).toHaveValue('5');
    await page.getByText('Section by section', { exact: true }).click();
    await page.mouse.move(-1, -1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `.runtime/race-analysis/overview-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    await page.getByText('How we worked this out', { exact: true }).click();
    await expect(page.locator('.race-reference-list > li')).toHaveCount(4);
    await expect(page.locator('.race-reference-list > li').first()).toContainText('Predicted');
    await page.getByRole('button', { name: 'Edit Crêtes du Lac', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Elapsed time (minutes)', { exact: true })
      .fill('320');
    await page.getByRole('button', { name: 'Save effort', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.locator('.race-reference-list > li').filter({ hasText: 'Crêtes du Lac' }),
    ).toContainText('5h 20m');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `.runtime/race-analysis/evidence-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    expect((await readAnalysis(page, baseURL!, raceId)).sectionTerrain).toEqual({ '0': 5 });
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (info.project.name === 'mobile') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `.runtime/race-analysis/narrow-${theme}.png`,
        fullPage: true,
        scale: 'css',
      });
    }
  });
}

test('invalid replacement retains the course; missing elevation stays unknown', async ({
  page,
  baseURL,
}, info) => {
  await signIn(page, 'dark');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await uploadCourse(page, syntheticGpx());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await readAnalysis(page, baseURL!, raceId);
  await uploadCourse(page, '<gpx><trk></gpx>', true);
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  expect((await readAnalysis(page, baseURL!, raceId)).course?.id).toBe(saved.course?.id);
  await page.screenshot({ path: `.runtime/race-analysis/upload-error-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await uploadCourse(page, syntheticGpx({ elevation: 'none' }), true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/No elevation in this file/)).toBeVisible();
  await expect(page.locator('.race-metrics')).toContainText('Unknown');
  await expect(page.locator('.race-finish')).toHaveCount(0);
  await uploadCourse(page, syntheticGpx({ ascent: 0 }), true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/No elevation in this file/)).toHaveCount(0);
  await expect(page.locator('.race-metrics')).toContainText('0 m');
  await page
    .locator('.race-profile')
    .screenshot({ path: `.runtime/race-analysis/flat-${info.project.name}.png`, scale: 'css' });
});

test('loading, retry and no-race states stay actionable', async ({ page, baseURL }, info) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**' + endpoint + 'analysis',
    async (route) => {
      await pending;
      await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    },
    { times: 1 },
  );
  await page.goto(`/races?race=${raceId}`);
  await expect(page.getByRole('status', { name: 'Loading course analysis' })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('See what the course asks of you')).toBeVisible();
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), state: emptyWorkspace() },
    });
  });
  await page.reload();
  await expect(page.getByText('Add a race to your calendar', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.runtime/race-analysis/no-races-${info.project.name}.png` });
});

test('upload transport rejects anonymous and foreign-origin requests', async ({
  page,
  request,
  baseURL,
}) => {
  const anonymous = await request.post(endpoint + 'uploads/track', {
    headers: { Origin: baseURL! },
  });
  expect(anonymous.status()).toBe(401);
  await signIn(page, 'light');
  const foreign = await page.request.post(endpoint + 'uploads/track', {
    headers: { Origin: 'https://example.invalid' },
  });
  expect(foreign.status()).toBe(403);
});

test('a stale terrain draft survives reload and can be reviewed before saving', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await uploadCourse(page, syntheticGpx());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Overall terrain' })
    .getByRole('button', { name: '4 Rocky' })
    .click();
  const current = await readAnalysis(page, baseURL!, raceId);
  const changed = await page.request.post(endpoint + 'settings', {
    headers: { Origin: baseURL! },
    data: {
      raceId,
      expectedRevision: current.revision,
      idempotencyKey: randomUUID(),
      terrain: 2,
      sectionTerrain: {},
    },
  });
  expect(changed.ok()).toBe(true);
  await page.getByRole('button', { name: 'Save terrain', exact: true }).click();
  await expect(page.getByText('The course or references changed.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(
    page.getByText('Saved data reloaded. Your terrain draft is retained for review.'),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Overall terrain' }).getByRole('button', { name: '4 Rocky' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect((await readAnalysis(page, baseURL!, raceId)).terrain).toBe(2);
  await page.getByRole('button', { name: 'Save terrain', exact: true }).click();
  await expect(page.getByText('Terrain saved. Estimate updated.')).toBeVisible();
  expect((await readAnalysis(page, baseURL!, raceId)).terrain).toBe(4);
});
