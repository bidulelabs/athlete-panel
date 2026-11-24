import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { courseRace, courseReferences, syntheticGpx } from '../fixtures/race-analysis';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');

export async function signIn(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
export async function ownerCommand(page: Page, baseURL: string, command: Record<string, unknown>) {
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: baseURL },
    data: { idempotencyKey: randomUUID(), commands: [command] },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
export async function createRace(page: Page, baseURL: string) {
  const { title, date, kind, notes } = courseRace();
  const id = randomUUID();
  await ownerCommand(page, baseURL, {
    action: 'event.create',
    values: { id, title, date, kind, notes },
  });
  return id;
}
export async function uploadCourse(page: Page, xml: string, replacing = false) {
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
export async function addReferences(page: Page, baseURL: string, raceId: string) {
  const readRevision = async () => {
    const response = await page.request.post('/api/plugins/race-analysis/analysis', {
      headers: { Origin: baseURL },
      data: { raceId },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return ((await response.json()) as { revision: number }).revision;
  };
  for (const reference of courseReferences.slice(0, 3)) {
    const response = await page.request.post('/api/plugins/race-analysis/uploads/track', {
      headers: { Origin: baseURL },
      multipart: {
        file: {
          name: reference.title + '.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(syntheticGpx(reference)),
        },
        metadata: JSON.stringify({
          raceId,
          purpose: 'reference',
          title: reference.title,
          terrain: 3,
          durationSeconds: null,
          expectedRevision: await readRevision(),
          idempotencyKey: randomUUID(),
        }),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}
export async function setNutrition(
  page: Page,
  baseURL: string,
  {
    products = [],
    preferences = '',
    carryCapacityMillilitres = null,
  }: {
    products?: Record<string, unknown>[];
    preferences?: string;
    carryCapacityMillilitres?: number | null;
  },
) {
  const workspace = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  const profile = (await workspace.json()).state.profile;
  await ownerCommand(page, baseURL, {
    action: 'profile.set',
    expectedRevision: profile?.revision ?? null,
    values: { nutrition: { products, carryCapacityMillilitres, preferences } },
  });
}
