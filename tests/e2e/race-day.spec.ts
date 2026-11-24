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

const openRaceDay = (page: Page) =>
  page.getByRole('tab', { name: 'Race day', exact: true }).click();
const stationNames = (page: Page) => page.locator('.race-stations th[scope="row"] strong');
const reviewNotice = (page: Page) =>
  page.getByText(
    'The course or your target changed after this plan was written. Check that the stations still hold.',
    { exact: true },
  );
async function fillStation(
  page: Page,
  station: { name: string; km: string; cutoff?: string; stop: string; source?: string },
) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(station.name);
  await dialog.getByLabel(/^Distance from the start/).fill(station.km);
  if (station.cutoff) await dialog.getByLabel('Time', { exact: true }).fill(station.cutoff);
  await dialog.getByLabel('Planned stop (minutes)', { exact: true }).fill(station.stop);
  await dialog.getByLabel('Water at this station', { exact: true }).focus();
  await page.keyboard.press('Space');
  if (station.source) {
    await dialog.getByLabel(/^Source/).fill(station.source);
    await dialog
      .getByLabel('Confirmed by the organizer or the race guide', { exact: true })
      .check();
  }
  await dialog.getByLabel('Name', { exact: true }).press('Enter');
  await expect(dialog).toHaveCount(0);
}

for (const theme of ['light', 'dark']) {
  test(`plan aid stations and race-day times by keyboard (${theme})`, async ({ page, baseURL }) => {
    await signIn(page, theme);
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await page.getByRole('tab', { name: 'Course', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Preparation', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Race day', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'No aid stations yet' })).toBeVisible();
    await expect(page.getByText('Arrival times are unknown', { exact: true })).toBeVisible();
    await expect(page.getByText('Cutoffs and stops still show.', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Carry amounts need leg times, so they are hidden.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What to carry' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add past efforts on Course', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Course', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await uploadCourse(page, syntheticGpx());
    await addReferences(page, baseURL!, raceId);
    await page.reload();
    await openRaceDay(page);
    await expect(page.getByText('Arrival times are unknown', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('Set a start time to see arrival clock times and cutoff margins.', {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add the first station', exact: true }).focus();
    await page.keyboard.press('Enter');
    await fillStation(page, { name: 'Grand Col', km: '28', cutoff: '12:45', stop: '6' });
    await page.getByRole('button', { name: 'Add station', exact: true }).click();
    await fillStation(page, {
      name: 'Les Pins',
      km: '9',
      cutoff: '09:15',
      stop: '4',
      source: 'race guide',
    });
    await expect(stationNames(page)).toHaveText(['Les Pins', 'Grand Col']);
    await expect(page.getByText('Confirmed · race guide', { exact: true })).toBeVisible();
    await expect(page.getByText('Not confirmed', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/^Start → Les Pins · 9\.0 km/)).toBeVisible();
    await expect(page.getByText(/^Grand Col → Finish/)).toBeVisible();
    await expect(page.locator('.race-day-moving')).toHaveText(/^\d+h \d\dm moving, 10m stops$/);
    await expect(page.locator('.race-day-headline')).toHaveText(
      /^Finish \d+h \d\dm after the start$/,
    );
    await expect(page.getByText(/ up · about /).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add station', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Same place');
    await dialog.getByLabel(/^Distance from the start/).fill('9');
    await dialog.getByLabel('Name', { exact: true }).press('Enter');
    await expect(
      dialog.getByText('Another aid station is already at this distance.', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(stationNames(page)).toHaveText(['Les Pins', 'Grand Col']);

    await page.getByRole('button', { name: 'Change start time', exact: true }).click();
    await dialog.getByLabel('Start time', { exact: true }).fill('07:00');
    await dialog.getByLabel('Time', { exact: true }).fill('15:00');
    await dialog.getByLabel('Start time', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.race-day-start')).toContainText('Start 07:00');
    await expect(page.locator('.race-day-headline')).toHaveText(/^Start 07:00 → finish \d\d:\d\d$/);
    await expect(page.locator('.race-day-cutoff')).toContainText('Finish cutoff 15:00 · ');
    await expect(page.getByText(/^aim \d\d:\d\d$/).first()).toBeVisible();
    await expect(page.getByText(/ (margin|after the cutoff)$/).first()).toBeVisible();

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize(viewport);

    await uploadCourse(page, syntheticGpx({ km: 30, salt: 'replacement' }), true);
    await openRaceDay(page);
    await expect(reviewNotice(page)).toBeVisible();
    await page.getByRole('tab', { name: 'Preparation', exact: true }).click();
    await expect(page.getByText(/changed after this strategy was written/)).toBeVisible();
    await openRaceDay(page);
    await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
    await expect(reviewNotice(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove Les Pins', exact: true }).click();
    await page.getByRole('button', { name: 'Remove station', exact: true }).click();
    await expect(stationNames(page)).toHaveText(['Grand Col']);
    await page.getByRole('button', { name: 'Remove Grand Col', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(stationNames(page)).toHaveText(['Grand Col']);
  });
}

test('keeps the station draft when the plan changed elsewhere, then saves it after a reload', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  const racePlanId = randomUUID();
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { id: racePlanId, eventId: raceId, target: 'Finish comfortably' },
  });
  await page.goto(`/races?race=${raceId}`);
  await openRaceDay(page);
  await page.getByRole('button', { name: 'Add the first station', exact: true }).click();
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.update',
    id: racePlanId,
    expectedRevision: 1,
    values: { startTime: '06:30' },
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Les Pins');
  await dialog.getByLabel(/^Distance from the start/).fill('9');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByText(/Use Reload saved data to review the saved version/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Les Pins');
  await expect(page.locator('.race-day-start')).toContainText('Start 06:30');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(stationNames(page)).toHaveText(['Les Pins']);
  await expect(page.locator('.race-day-start')).toContainText('Start 06:30');
});

test('shows a station beyond the course, a missed cutoff and stops longer than the estimate', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await uploadCourse(page, syntheticGpx());
  await addReferences(page, baseURL!, raceId);
  const station = (name: string, distanceMeters: number, values = {}) => ({
    id: randomUUID(),
    name,
    distanceMeters,
    cutoff: null,
    stopSeconds: 0,
    water: false,
    food: '',
    dropBag: [],
    action: '',
    source: '',
    verified: false,
    ...values,
  });
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: {
      eventId: raceId,
      startTime: '07:00',
      finishCutoff: { dayOffset: 0, time: '08:00' },
      stations: [
        station('Les Pins', 9000, {
          cutoff: { dayOffset: 0, time: '07:10' },
          stopSeconds: 86400,
        }),
        station('Far Away', 90000),
      ],
    },
  });
  await page.reload();
  await openRaceDay(page);
  const farAway = page.locator('.race-stations tr').filter({ hasText: 'Far Away' });
  await expect(farAway.getByText('Beyond the course', { exact: true })).toBeVisible();
  await expect(farAway.getByText('No arrival', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Planned stops are longer than the whole estimate. Moving time is shown as 0.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.race-day-moving')).toHaveText(/^0h 00m moving, 24h stops$/);
  await expect(
    page.getByText('Carry amounts need leg times, so they are hidden.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to carry' })).toHaveCount(0);
  const lesPins = page.locator('.race-stations tr').filter({ hasText: 'Les Pins' });
  await expect(lesPins.locator('.race-late')).toHaveText(/ after the cutoff$/);
  await expect(page.locator('.race-day-cutoff .race-late')).toHaveText(
    /Latest finish is .+ after the cutoff$/,
  );
  await expect(page.getByText(/^Les Pins → Finish · /)).toBeVisible();
  await expect(page.getByText(/^Far Away → /)).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`shows what to carry from a drop bag and the carry capacity by keyboard (${theme})`, async ({
    page,
    baseURL,
  }) => {
    await signIn(page, theme);
    const gelId = randomUUID();
    await setNutrition(page, baseURL!, {
      products: [
        {
          id: gelId,
          name: 'Synthetic gel',
          kind: 'gel',
          carbohydrateGrams: 25,
          fluidMillilitres: null,
          sodiumMilligrams: null,
          caffeineMilligrams: null,
          source: 'label',
          tolerance: 'comfortable',
        },
      ],
      carryCapacityMillilitres: 250,
    });
    const raceId = await createRace(page, baseURL!);
    await ownerCommand(page, baseURL!, {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        target: 'Finish comfortably',
        nutrition: {
          targets: {
            carbohydrateGramsPerHour: null,
            fluidMillilitresPerHour: 500,
            sodiumMilligramsPerHour: null,
          },
          schedule: [{ productId: gelId, servings: 1, everyMinutes: 20 }],
          cues: [],
          daysBefore: '',
          breakfast: '',
          recovery: '',
        },
      },
    });
    await page.goto(`/races?race=${raceId}`);
    await uploadCourse(page, syntheticGpx());
    await addReferences(page, baseURL!, raceId);
    await page.reload();
    await openRaceDay(page);
    await expect(page.getByRole('heading', { name: 'What to carry' })).toBeVisible();
    await expect(
      page.getByText('One leg is over your carrying capacity', { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add the first station', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('Grand Col');
    await dialog.getByLabel(/^Distance from the start/).fill('10');
    await dialog.getByLabel('Water at this station', { exact: true }).focus();
    await page.keyboard.press('Space');
    await dialog.getByRole('button', { name: 'Add drop bag item', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox', { name: 'Product' })).toHaveValue(gelId);
    await dialog.getByLabel('Servings', { exact: true }).fill('1');
    await dialog.getByLabel('Name', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Grand Col drop bag' })).toBeVisible();
    await expect(page.getByText('1 × Synthetic gel', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\d+ × Synthetic gel short until Finish$/)).toBeVisible();
    await expect(page.getByText(/^\d+ legs are over your carrying capacity$/)).toBeVisible();
    await expect(page.getByText(/You carry up to 0\.25 L\.$/).first()).toBeVisible();
    await expect(
      page.getByText(/^carry 0\.25 L water, \d+ × Synthetic gel, over capacity$/).first(),
    ).toBeVisible();
    await expect(page.getByText(/Leave with|still counted:/)).toHaveCount(0);
    await page.getByText('How this is worked out', { exact: true }).click();
    await expect(
      page.getByText('Unconfirmed stations are still counted.', { exact: true }),
    ).toBeVisible();

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize(viewport);

    await page.getByRole('button', { name: 'Edit Grand Col', exact: true }).click();
    await expect(dialog.getByLabel('Servings', { exact: true })).toHaveValue('1');
    await dialog.getByRole('button', { name: 'Remove drop bag item 1', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Grand Col drop bag' })).toHaveCount(0);
  });
}
