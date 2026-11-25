import { randomUUID } from 'node:crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
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
  await expect(page.getByRole('button', { name: 'New scenario' })).toBeEnabled();
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

const saveButton = (page: Page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true });
const dialogOf = (page: Page) => page.getByRole('dialog');
const pressEnterOn = async (page: Page, button: Locator) => {
  await button.focus();
  await page.keyboard.press('Enter');
};

async function raceWithPlan(page: Page, baseURL: string) {
  const raceId = await createRace(page, baseURL);
  const lesPins = station('Les Pins', 9000);
  const grandCol = station('Grand Col', 28000);
  await ownerCommand(page, baseURL, {
    action: 'racePlan.create',
    values: { eventId: raceId, startTime: '07:00', stations: [lesPins, grandCol] },
  });
  const basedOn = {
    courseId: null,
    stations: [
      { id: lesPins.id, distanceMeters: 9000 },
      { id: grandCol.id, distanceMeters: 28000 },
    ],
  };
  return { raceId, lesPins, grandCol, basedOn };
}

const scenarioRow = (page: Page, name: string) =>
  page.locator('.race-scenario').filter({ has: page.locator('strong', { hasText: name }) });
const readScenarios = async (page: Page) => {
  const workspace = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  return (await workspace.json()).state.raceScenarios as { id: string; revision: number }[];
};

for (const theme of ['light', 'dark']) {
  test(`creates, edits and duplicates a scenario by keyboard, with Enter submitting (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page, theme);
    const { raceId } = await raceWithPlan(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await openScenarios(page);
    await pressEnterOn(page, page.getByRole('button', { name: 'New scenario', exact: true }));
    const dialog = dialogOf(page);
    await dialog.getByLabel('Name', { exact: true }).fill('Hot and careful');
    await dialog.getByLabel('Effort (%)', { exact: true }).fill('8');
    await dialog.getByLabel('Weather (%)', { exact: true }).fill('6');
    await dialog.getByLabel('Weather note').fill('Hot valley');
    await dialog.getByLabel('Les Pins stop in this scenario (minutes)').fill('9');
    await expect(dialog.getByText('enter every value')).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByLabel('Name', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    const row = scenarioRow(page, 'Hot and careful');
    await expect(row).toContainText('Effort +8 % · weather +6 % (your assumption) · 14m of stops');
    await expect(row).not.toContainText('Outdated');

    await pressEnterOn(
      page,
      page.getByRole('button', { name: 'Edit Hot and careful', exact: true }),
    );
    await expect(dialog.getByLabel('Effort (%)', { exact: true })).toHaveValue('8');
    await expect(dialog.getByLabel('Les Pins stop in this scenario (minutes)')).toHaveValue('9');
    await dialog.getByLabel('Effort (%)', { exact: true }).fill('10');
    await dialog.getByLabel('Effort (%)', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText('Effort +10 %');

    await pressEnterOn(
      page,
      page.getByRole('button', { name: 'Duplicate Hot and careful', exact: true }),
    );
    await expect(scenarioNames(page)).toHaveText(['Hot and careful', 'Hot and careful (copy)']);
    await expect(scenarioRow(page, 'Hot and careful (copy)')).toContainText('Effort +10 %');
    await noOverflowAt320(page);
  });
}

test('disables New scenario and Duplicate with their reason at four scenarios', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const { raceId, basedOn } = await raceWithPlan(page, baseURL!);
  for (const name of ['One', 'Two', 'Three'])
    await ownerCommand(page, baseURL!, scenario(raceId, name, { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.getByRole('button', { name: 'New scenario', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Duplicate One', exact: true })).toBeEnabled();
  await ownerCommand(page, baseURL!, scenario(raceId, 'Four', { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.getByRole('button', { name: 'New scenario', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Duplicate One', exact: true })).toBeDisabled();
  await expect(
    page.getByText('A race holds at most 4 scenarios. Delete one to add another.'),
  ).toBeVisible();
});

test('saves an outdated scenario unchanged to bring it up to date, and sends nothing for an up-to-date one', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const { raceId, lesPins, grandCol, basedOn } = await raceWithPlan(page, baseURL!);
  await ownerCommand(page, baseURL!, scenario(raceId, 'Current', { basedOn }));
  await ownerCommand(
    page,
    baseURL!,
    scenario(raceId, 'Old', {
      basedOn: {
        ...basedOn,
        stations: [{ id: lesPins.id, distanceMeters: 8000 }, basedOn.stations[1]],
      },
      stops: [
        { stationId: lesPins.id, stopSeconds: 300 },
        { stationId: grandCol.id, stopSeconds: 300 },
      ],
    }),
  );
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.getByText('Outdated', { exact: true })).toHaveCount(1);
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/training/mutate'))
      mutations.push(request.url());
  });

  await page.getByRole('button', { name: 'Edit Current', exact: true }).click();
  await saveButton(page).click();
  await expect(dialogOf(page)).toHaveCount(0);
  expect(mutations).toHaveLength(0);

  await page.getByRole('button', { name: 'Edit Old', exact: true }).click();
  await dialogOf(page).getByLabel('Name', { exact: true }).press('Enter');
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(page.getByText('Outdated', { exact: true })).toHaveCount(0);
  expect(mutations).toHaveLength(1);
});

test('keeps the draft when the scenario changed elsewhere, then saves it after a reload', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'dark');
  const { raceId, basedOn } = await raceWithPlan(page, baseURL!);
  await ownerCommand(page, baseURL!, scenario(raceId, 'Hot', { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await page.getByRole('button', { name: 'Edit Hot', exact: true }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel('Name', { exact: true }).fill('Hot and dry');
  const [{ id, revision }] = await readScenarios(page);
  await ownerCommand(page, baseURL!, {
    action: 'raceScenario.update',
    id,
    expectedRevision: revision,
    values: { effortPercent: 4 },
  });
  await saveButton(page).click();
  await expect(dialog.getByText(/Use Reload saved data to review the saved version/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(
    dialog.getByText('Saved data reloaded. Review it before saving again.'),
  ).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Hot and dry');
  await saveButton(page).click();
  await expect(dialog).toHaveCount(0);
  const row = scenarioRow(page, 'Hot and dry');
  await expect(row).toContainText('Effort +4 %');
});

test('keeps the draft after a server outage', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const { raceId } = await raceWithPlan(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel('Name', { exact: true }).fill('Calm');
  const outage = '**/api/plugins/training/**';
  await page.route(outage, (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Synthetic outage' } } }),
  );
  await saveButton(page).click();
  await expect(dialog.getByText('Synthetic outage')).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Calm');
  await page.unroute(outage);
  await saveButton(page).click();
  await expect(dialog).toHaveCount(0);
  await expect(scenarioNames(page)).toHaveText(['Calm']);
});

test('refuses the fourth scenario made from a second tab and keeps the draft', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const { raceId, basedOn } = await raceWithPlan(page, baseURL!);
  for (const name of ['One', 'Two'])
    await ownerCommand(page, baseURL!, scenario(raceId, name, { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel('Name', { exact: true }).fill('Late one');
  const secondTab = await page.context().newPage();
  for (const name of ['Three', 'Four'])
    await ownerCommand(secondTab, baseURL!, scenario(raceId, name, { basedOn }));
  await saveButton(page).click();
  await expect(dialog.getByText('A race holds at most 4 scenarios.')).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Late one');
});
