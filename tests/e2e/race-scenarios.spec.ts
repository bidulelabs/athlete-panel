import { randomUUID } from 'node:crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { syntheticGpx } from '../fixtures/race-analysis';
import {
  addReferences,
  createRace,
  ownerCommand,
  setNutrition,
  signIn,
  uploadCourse,
} from './race-helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});
const scenarioHeads = (page: Page) =>
  page
    .locator('.race-scenario-table thead th:not(.race-scenario-plan)')
    .filter({ has: page.locator('strong') });
const scenarioNames = (page: Page) => scenarioHeads(page).locator('strong');
const actionsOf = (page: Page, name: string) => page.getByLabel(`${name} actions`, { exact: true });
const rowOf = (page: Page, label: string) =>
  page
    .locator('.race-scenario-table tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: label }) });
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
    const grandCol = station('Grand Col', 28000, { cutoff: { dayOffset: 0, time: '23:30' } });
    await ownerCommand(page, baseURL!, {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        courseId: course.id,
        startTime: '07:00',
        finishCutoff: { dayOffset: 0, time: '23:59' },
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
    const hotHead = scenarioHeads(page).filter({ hasText: 'Hot and careful' });
    const calmHead = scenarioHeads(page).filter({ hasText: 'Effort -5 %' });
    const movedStationHead = scenarioHeads(page).filter({ hasText: 'Effort -10 %' });
    await expect(page.locator('.race-scenario-plan strong')).toHaveText('Current plan');
    await expect(hotHead).toContainText(
      'Effort +8 % · weather +6 % (your assumption) · 20m of stops',
    );
    await expect(calmHead).toContainText('Effort -5 % · weather 0 % (your assumption)');
    await expect(page.getByText('Outdated', { exact: true })).toHaveCount(1);
    await expect(movedStationHead).toContainText('Outdated');
    await expect(movedStationHead).not.toContainText('Les Pins was moved.');
    await expect(calmHead).not.toContainText('Outdated');
    await expect(page.locator('.race-data-notice strong')).toHaveText([
      '“Ambitious” was saved before the plan changed',
      'Ranges are not guarantees',
    ]);
    const outdatedNotice = page.locator('.race-data-notice', { hasText: 'was saved before' });
    await expect(outdatedNotice).toContainText(
      'Les Pins was moved. Review the stops, then save it again.',
    );
    await page.getByText('How this is worked out', { exact: true }).click();
    await expect(page.getByText('Margins use the latest arrival.')).toBeVisible();
    await page.getByText('How this is worked out', { exact: true }).click();
    await pressEnterOn(page, outdatedNotice.getByRole('button', { name: 'Review stops' }));
    await expect(dialogOf(page).getByLabel('Name', { exact: true })).toHaveValue('Ambitious');
    await expect(dialogOf(page).getByLabel('Effort (%)', { exact: true })).toHaveValue('-10');
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);

    const finishRow = rowOf(page, 'Expected finish').locator('td');
    await expect(finishRow).toHaveCount(4);
    await expect(finishRow.nth(0)).toContainText(/^\d\d:\d\d/);
    await expect(finishRow.nth(0)).toContainText(/range \d\d:\d\d–\d\d:\d\d/);
    await expect(finishRow.nth(3)).toContainText(/\d+h( \d+m)? later|\d+m later/);
    await expect(finishRow.nth(1)).toContainText(/earlier/);
    await expect(rowOf(page, 'Moving · stopped').locator('td').nth(3)).toContainText(' · 20m');
    await expect(rowOf(page, 'Finish cutoff 23:59').locator('td').nth(3)).toContainText('margin');
    await expect(rowOf(page, 'Grand Col · cutoff 23:30').locator('td').nth(0)).toContainText(
      /\d\d:\d\d · latest \d\d:\d\d/,
    );
    await expect(rowOf(page, 'What to carry')).toBeVisible();
    const whyRow = rowOf(page, 'Why it changes').locator('td');
    await expect(whyRow.nth(0)).toHaveText('The reference');
    await expect(whyRow.nth(3)).toContainText(/Moving time \+\d+ min: effort \+8 %, weather \+6 %/);
    await expect(whyRow.nth(3)).toContainText('Stops +10 min: Grand Col 15 min');
    await expect(rowOf(page, 'Why it changes')).toContainText(/Moving time -\d+ min: effort -5 %/);

    const boxes = await page
      .locator('.race-scenario-table thead th')
      .evaluateAll((heads) =>
        heads.map((head) => head.getBoundingClientRect()).map(({ x, y }) => ({ x, y })),
      );
    expect(new Set(boxes.map(({ y }) => y)).size).toBe(1);
    expect(boxes.map(({ x }) => x)).toEqual([...boxes.map(({ x }) => x)].sort((a, b) => a - b));
    await noOverflowAt320(page);

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(rowOf(page, 'Expected finish')).toContainText(
      /plan: \d\d:\d\d · range \d\d:\d\d–\d\d:\d\d/,
    );
    await expect(rowOf(page, 'Finish cutoff 23:59')).toContainText(/plan: .+ margin/);
    await expect(rowOf(page, 'Grand Col · cutoff 23:30')).toContainText(
      /plan: \d\d:\d\d · latest \d\d:\d\d · .+ margin/,
    );
    await page.setViewportSize(viewport);

    await actionsOf(page, 'Hot and careful').selectOption('Delete');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(scenarioNames(page)).toHaveCount(3);
    await actionsOf(page, 'Hot and careful').selectOption('Delete');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(scenarioNames(page)).toHaveText(['Ambitious', 'Ambitious']);
  });
}

test('shows one scenario at a time on a phone, with the plan value under each row', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'dark');
  const { raceId, basedOn, grandCol } = await raceWithPlan(page, baseURL!);
  await ownerCommand(
    page,
    baseURL!,
    scenario(raceId, 'Longer stops', {
      stops: [{ stationId: grandCol.id, stopSeconds: 900 }],
      basedOn,
    }),
  );
  await ownerCommand(page, baseURL!, scenario(raceId, 'Same as plan', { basedOn }));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.locator('.race-scenario-plan')).toHaveCount(0);
  await expect(scenarioNames(page)).toHaveText(['Longer stops']);
  const picker = page.getByRole('combobox', { name: 'Scenario', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
  await expect(rowOf(page, 'Moving · stopped')).toContainText('plan: ');
  await expect(rowOf(page, 'Moving · stopped')).toContainText('· 20m');
  const why = page.locator('details', { hasText: 'Why it changes' });
  await expect(why).not.toHaveAttribute('open', '');
  await why.getByText('Why it changes').click();
  await expect(why).toContainText('Stops +10 min: Grand Col 15 min');
  await picker.selectOption({ index: 1 });
  await expect(scenarioNames(page)).toHaveText(['Same as plan']);
  await why.getByText('Why it changes').click();
  await expect(why).toContainText('No change from the plan');
  await noOverflowAt320(page);
});

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
  await expect(rowOf(page, 'Expected finish')).toContainText('Unknown');
  await expect(rowOf(page, 'Why it changes')).toContainText(
    'Effort +5 %: not calculated without a course estimate',
  );
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
  scenarioHeads(page).filter({ has: page.locator('strong', { hasText: name }) });
const readScenarios = async (page: Page, raceId: string) => {
  const workspace = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  const scenarios = (await workspace.json()).state.raceScenarios as {
    id: string;
    eventId: string;
    revision: number;
  }[];
  return scenarios.filter((saved) => saved.eventId === raceId);
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

    await actionsOf(page, 'Hot and careful').selectOption('Edit');
    await expect(dialog.getByLabel('Effort (%)', { exact: true })).toHaveValue('8');
    await expect(dialog.getByLabel('Les Pins stop in this scenario (minutes)')).toHaveValue('9');
    await dialog.getByLabel('Effort (%)', { exact: true }).fill('10');
    await dialog.getByLabel('Effort (%)', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText('Effort +10 %');

    await actionsOf(page, 'Hot and careful').selectOption('Duplicate');
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
  const duplicateOfOne = actionsOf(page, 'One').locator('option[value="Duplicate"]');
  await expect(duplicateOfOne).toBeEnabled();
  await ownerCommand(page, baseURL!, scenario(raceId, 'Four', { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await expect(page.getByRole('button', { name: 'New scenario', exact: true })).toBeDisabled();
  await expect(duplicateOfOne).toBeDisabled();
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

  await actionsOf(page, 'Current').selectOption('Edit');
  await saveButton(page).click();
  await expect(dialogOf(page)).toHaveCount(0);
  expect(mutations).toHaveLength(0);

  await actionsOf(page, 'Old').selectOption('Edit');
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
  await actionsOf(page, 'Hot').selectOption('Edit');
  const dialog = dialogOf(page);
  await dialog.getByLabel('Name', { exact: true }).fill('Hot and dry');
  const [{ id, revision }] = await readScenarios(page, raceId);
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

test('reaches each Actions select by Tab and leaves it on Actions after Edit', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const { raceId, basedOn } = await raceWithPlan(page, baseURL!);
  await ownerCommand(page, baseURL!, scenario(raceId, 'Calm', { basedOn }));
  await ownerCommand(page, baseURL!, scenario(raceId, 'Hot', { basedOn }));
  await page.goto(`/races?race=${raceId}`);
  await openScenarios(page);
  await actionsOf(page, 'Calm').focus();
  await page.keyboard.press('Tab');
  await expect(actionsOf(page, 'Hot')).toBeFocused();
  await actionsOf(page, 'Hot').selectOption('Edit');
  await expect(dialogOf(page)).toBeVisible();
  await dialogOf(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(actionsOf(page, 'Hot')).toHaveValue('');
  await expect(scenarioNames(page)).toHaveText(['Calm', 'Hot']);
});

for (const theme of ['light', 'dark']) {
  test(`warns about a missed cutoff and a leg over the bottles of a scenario, and keeps the notices at 320 px (${theme})`, async ({
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
    await setNutrition(page, baseURL!, { carryCapacityMillilitres: 250 });
    const tightStation = station('Tight Col', 9000, { cutoff: { dayOffset: 0, time: '07:10' } });
    await ownerCommand(page, baseURL!, {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        courseId: course.id,
        startTime: '07:00',
        finishCutoff: { dayOffset: 0, time: '07:20' },
        stations: [tightStation],
        nutrition: {
          targets: {
            carbohydrateGramsPerHour: null,
            fluidMillilitresPerHour: 500,
            sodiumMilligramsPerHour: null,
          },
          schedule: [],
          cues: [],
          daysBefore: '',
          breakfast: '',
          recovery: '',
        },
      },
    });
    await ownerCommand(
      page,
      baseURL!,
      scenario(raceId, 'Hot and careful', {
        effortPercent: 8,
        basedOn: {
          courseId: course.id,
          stations: [{ id: tightStation.id, distanceMeters: 9000 }],
        },
      }),
    );
    await page.goto(`/races?race=${raceId}`);
    await openScenarios(page);

    const missedNotice = page.locator('.race-data-notice', { hasText: 'misses 2 cutoffs' });
    await expect(missedNotice.locator('strong')).toHaveText(
      '“Hot and careful” misses 2 cutoffs at its latest arrival',
    );
    await expect(missedNotice).toContainText(/Tight Col by \d+ min and the finish by \d+ min\./);
    await expect(missedNotice).toContainText('check the course estimate');
    const carryNotice = page.locator('.race-data-notice', { hasText: 'bottles hold 0.25 L' });
    await expect(carryNotice.locator('strong')).toHaveText(
      /^Hot and careful: (Last leg|The leg ending at [\d.]+ km) needs [\d.]+ L, bottles hold 0.25 L$/,
    );
    await expect(carryNotice).toContainText('Add capacity in Settings or plan a refill.');
    await expect(page.getByRole('button', { name: 'Review stops' })).toHaveCount(0);
    await noOverflowAt320(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(missedNotice).toBeVisible();
    await expect(carryNotice).toBeVisible();
    await expect(page.getByText('Ranges are not guarantees')).toBeVisible();
    await noOverflowAt320(page);
  });
}
