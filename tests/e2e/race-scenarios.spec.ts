import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { syntheticGpx } from '../fixtures/race-analysis';
import { addReferences, createRace, ownerCommand, signIn, uploadCourse } from './race-helpers';

const scenarioNames = (page: Page) => page.locator('.race-scenario strong');
const openScenarios = async (page: Page) => {
  await page.getByRole('tab', { name: 'Race day', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Scenarios', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
};
const station = (name: string, distanceMeters: number, values = {}) => ({
  id: randomUUID(),
  name,
  distanceMeters,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: true,
  ...values,
});
const scenario = (eventId: string, name: string, values: Record<string, unknown>) => ({
  action: 'raceScenario.create',
  values: {
    id: randomUUID(),
    eventId,
    name,
    effortPercent: 0,
    weatherPercent: 0,
    weatherNote: '',
    stops: [],
    basedOn: { courseId: null, stations: [] },
    ...values,
  },
});
const noOverflowAt320 = async (page: Page) => {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize(viewport);
};

for (const theme of ['light', 'dark']) {
  test(`lists scenarios with their finish, marks an outdated one and deletes one by keyboard (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page, theme);
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await uploadCourse(page, syntheticGpx());
    await addReferences(page, baseURL!, raceId);
    const analysis = await page.request.post('/api/plugins/race-analysis/analysis', {
      headers: { Origin: baseURL! },
      data: { raceId },
    });
    const { course } = (await analysis.json()) as { course: { id: string } };
    const lesPins = station('Les Pins', 9000);
    const grandCol = station('Grand Col', 28000);
    await ownerCommand(page, baseURL!, {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        courseId: course.id,
        startTime: '07:00',
        stations: [lesPins, grandCol],
      },
    });
    const upToDate = {
      courseId: course.id,
      stations: [
        { id: lesPins.id, distanceMeters: 9000 },
        { id: grandCol.id, distanceMeters: 28000 },
      ],
    };
    await ownerCommand(
      page,
      baseURL!,
      scenario(raceId, 'Hot and careful', {
        effortPercent: 8,
        weatherPercent: 6,
        stops: [{ stationId: grandCol.id, stopSeconds: 900 }],
        basedOn: upToDate,
      }),
    );
    await ownerCommand(
      page,
      baseURL!,
      scenario(raceId, 'Ambitious', { effortPercent: -5, basedOn: upToDate }),
    );
    await ownerCommand(
      page,
      baseURL!,
      scenario(raceId, 'Ambitious', {
        effortPercent: -10,
        basedOn: {
          ...upToDate,
          stations: [{ id: lesPins.id, distanceMeters: 8000 }, upToDate.stations[1]],
        },
      }),
    );
    await page.goto(`/races?race=${raceId}`);
    await openScenarios(page);

    await expect(page.getByRole('heading', { name: 'Compare race-day options' })).toBeVisible();
    await expect(scenarioNames(page)).toHaveText(['Ambitious', 'Ambitious', 'Hot and careful']);
    const rows = page.locator('.race-scenario');
    const hotRow = rows.filter({ hasText: 'Hot and careful' });
    const calmRow = rows.filter({ hasText: 'Effort -5 %' });
    const movedStationRow = rows.filter({ hasText: 'Effort -10 %' });
    await expect(hotRow).toContainText(
      'Effort +8 % · weather +6 % (your assumption) · 20m of stops',
    );
    await expect(hotRow.locator('.race-scenario-finish')).toContainText(/Finish\d\d:\d\d/);
    await expect(calmRow).toContainText('Effort -5 % · weather 0 % (your assumption)');
    await expect(page.getByText('Outdated', { exact: true })).toHaveCount(1);
    await expect(movedStationRow).toContainText('Outdated');
    await expect(movedStationRow).toContainText('Les Pins was moved.');
    await expect(calmRow).not.toContainText('Outdated');
    await noOverflowAt320(page);

    await page.getByRole('button', { name: 'Delete Hot and careful', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(scenarioNames(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Delete Hot and careful', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(scenarioNames(page)).toHaveText(['Ambitious', 'Ambitious']);
  });
}

test('says a race plan is needed before any scenario', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.getByRole('heading', { name: 'Save a race plan first' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New scenario' })).toHaveCount(0);
  await noOverflowAt320(page);
});

test('invites the first scenario of a race with a plan, and says when finish times need an estimate', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'dark');
  const raceId = await createRace(page, baseURL!);
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { eventId: raceId, startTime: '07:00' },
  });
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(
    page.getByRole('heading', { name: 'Compare options before choosing' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'New scenario' })).toHaveCount(0);
  await expect(page.getByText('Finish times need a course estimate')).toBeVisible();

  await ownerCommand(
    page,
    baseURL!,
    scenario(raceId, 'Longer stops', { effortPercent: 5, stops: [] }),
  );
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(scenarioNames(page)).toHaveText(['Longer stops']);
  await expect(page.locator('.race-scenario-finish')).toContainText('Unknown');
  await page.getByRole('button', { name: 'Open Course', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Course', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await noOverflowAt320(page);
});
