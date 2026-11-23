import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

const stopTitles = (page: Page) => page.locator('.race-card-stops li strong');
const openRaceCard = (page: Page) =>
  page.getByRole('tab', { name: 'Race card', exact: true }).click();
const station = (name: string, distanceMeters: number, values = {}) => ({
  id: randomUUID(),
  name,
  distanceMeters,
  cutoff: null,
  stopSeconds: 240,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: true,
  ...values,
});

for (const theme of ['light', 'dark']) {
  test(`plans a whole race on the card, downloads it and prints it by keyboard (${theme})`, async ({
    page,
    baseURL,
  }, testInfo) => {
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
      carryCapacityMillilitres: 1000,
    });
    const raceId = await createRace(page, baseURL!);
    await page.goto(`/races?race=${raceId}`);
    await uploadCourse(page, syntheticGpx());
    await addReferences(page, baseURL!, raceId);
    const analysis = await page.request.post('/api/plugins/race-analysis/analysis', {
      headers: { Origin: baseURL! },
      data: { raceId },
    });
    const { course } = (await analysis.json()) as { course: { id: string } };
    await ownerCommand(page, baseURL!, {
      action: 'racePlan.create',
      values: {
        eventId: raceId,
        courseId: course.id,
        target: 'Finish comfortably',
        briefing: 'Easy start. Protect the final climb.',
        startTime: '07:00',
        finishCutoff: { dayOffset: 0, time: '15:00' },
        stations: [
          station('Les Pins', 9000, { action: 'Refill both bottles' }),
          station('La Combe', 19000, { action: 'Refill water', verified: false }),
          station('Grand Col', 28000, {
            action: 'Collect the drop bag',
            cutoff: { dayOffset: 0, time: '12:45' },
            dropBag: [{ productId: gelId, servings: 2 }],
          }),
          station('Le Refuge', 35000, { action: 'Top up water' }),
        ],
        nutrition: {
          targets: {
            carbohydrateGramsPerHour: 50,
            fluidMillilitresPerHour: 500,
            sodiumMilligramsPerHour: null,
          },
          schedule: [{ productId: gelId, servings: 1, everyMinutes: 30 }],
          cues: [{ when: 'Final climb', text: 'Take a gel at the foot of it' }],
          daysBefore: 'Not on the card',
          breakfast: 'Rice and honey, two hours before the start',
          recovery: 'Drink and eat within thirty minutes of the finish',
        },
      },
    });
    await page.goto(`/races?race=${raceId}`);

    await page.getByRole('tab', { name: 'Course', exact: true }).focus();
    for (const name of ['Preparation', 'Race day', 'Nutrition', 'Race card']) {
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await expect(page.getByRole('tab', { name: 'Race card', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Your race card' })).toBeVisible();
    await expect(
      page.getByText('Written for alpine-trail-42.gpx', { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText(/plan revision 1$/).first()).toBeVisible();
    await expect(stopTitles(page)).toHaveText([
      'Start · 07:00',
      'Les Pins · 9.0 km',
      'La Combe · 19.0 km',
      'Grand Col · 28.0 km',
      'Le Refuge · 35.0 km',
      'Finish · 42.0 km',
    ]);
    await expect(page.getByText('Expected finish', { exact: true })).toBeVisible();
    await expect(page.locator('.race-card-finish')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.getByText('Easy start. Protect the final climb.')).toBeVisible();
    await expect(
      page.getByText('Rice and honey, two hours before the start', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Drink and eat within thirty minutes of the finish', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Not on the card')).toHaveCount(0);
    await expect(page.locator('.race-card-cues li')).toHaveText(
      'Final climb: Take a gel at the foot of it',
    );
    await expect(page.locator('.race-card-sheet > p').filter({ hasText: /^Food/ })).toHaveText(
      'Food · 50 g carbohydrate per hour, 500 ml fluid per hour: 1 × Synthetic gel, every 30 min',
    );
    await expect(page.getByText(/^Leave with .*× Synthetic gel/).first()).toBeVisible();
    await expect(page.getByText('Refill both bottles')).toBeVisible();
    const laCombe = page.locator('.race-card-stops li').filter({ hasText: 'La Combe' });
    await expect(laCombe).toContainText('not confirmed');
    const grandCol = page.locator('.race-card-stops li').filter({ hasText: 'Grand Col' });
    await expect(grandCol.locator('.race-card-detail').first()).toHaveText(
      /^Cutoff 12:45 · .+ margin$/,
    );
    await expect(grandCol.locator('.race-card-body p').first()).toHaveText('Collect the drop bag');
    await expect(grandCol.locator('.race-card-body p').nth(1)).toHaveText(/^Leave with /);
    await expect(page.locator('.race-card-time')).toHaveCount(4);
    await expect(page.locator('.race-card-sheet .race-data-notice')).toHaveCount(0);
    await expect(page.locator('.race-review-notice')).toHaveCount(0);

    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const lesPins = page.locator('.race-card-stops li').filter({ hasText: 'Les Pins' });
    const titleBox = (await lesPins.locator('.race-card-title').boundingBox())!;
    const timeBox = (await lesPins.locator('.race-card-time').boundingBox())!;
    const bodyBox = (await lesPins.locator('.race-card-body').boundingBox())!;
    expect(timeBox.y).toBeLessThan(titleBox.y + titleBox.height);
    expect(timeBox.y).toBeLessThan(bodyBox.y);
    await page.setViewportSize(viewport);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download offline copy', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('alpine-trail-42-race-card.html');
    const html = await readFile((await download.path())!, 'utf8');
    expect(html).toContain('Grand Col');
    expect(html).toContain('plan revision 1');
    expect(html).not.toContain('needed review');
    expect(html).not.toContain('Not on the card');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]*\b(?:src|href)\s*=/i);

    const offline = await page.context().newPage();
    await offline.setViewportSize({ width: 320, height: 900 });
    await offline.setContent(html);
    const cueTextWidth = await offline
      .locator('section ul li')
      .first()
      .evaluate((cue) => {
        const range = document.createRange();
        range.selectNodeContents(cue);
        return range.getBoundingClientRect().width;
      });
    expect(cueTextWidth).toBeGreaterThan(200);
    const stopBox = (await offline.locator('.stops li').first().boundingBox())!;
    expect(stopBox.width).toBeGreaterThan(200);
    expect(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await offline.close();

    const appMenu = page.locator(testInfo.project.name === 'mobile' ? '.mobile-bar' : '.sidebar');
    await expect(appMenu).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Race views' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(appMenu).toBeHidden();
    await expect(page.getByRole('tablist', { name: 'Race views' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();
    await expect(page.locator('.race-card-sheet')).toBeVisible();
    await expect(stopTitles(page).first()).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    await uploadCourse(page, syntheticGpx({ km: 30, salt: 'replacement' }), true);
    await openRaceCard(page);
    await expect(page.getByText('This plan needs review', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'The course or your target changed after this plan was written. Check that the card still holds.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('.race-card-review-line')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.race-card-review-line')).toBeVisible();
    await expect(page.locator('.race-review-notice')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    const [reviewDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download offline copy', exact: true }).click(),
    ]);
    expect(await readFile((await reviewDownload.path())!, 'utf8')).toContain(
      'This plan needed review when this copy was downloaded',
    );
    await page.getByRole('tab', { name: 'Race day', exact: true }).click();
    await expect(
      page.getByText(
        'The course or your target changed after this plan was written. Check that the stations still hold.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Nutrition', exact: true }).click();
    await expect(
      page.getByText(
        'The course or your target changed after this plan was written. Check that the nutrition plan still holds.',
        { exact: true },
      ),
    ).toBeVisible();
    await openRaceCard(page);
    await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
    await expect(page.getByText('This plan needs review', { exact: true })).toHaveCount(0);
  });
}

test('says there is no race card until the race has a plan', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await page.goto(`/races?race=${raceId}`);
  await openRaceCard(page);
  await expect(page.getByRole('heading', { name: 'No race card yet' })).toBeVisible();
  await expect(
    page.getByText(
      'The card is built from the aid stations on Race day and the food plan on Nutrition. Add either one to see it here.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download offline copy' })).toHaveCount(0);
});

test('says there is no race card for a plan with a target only', async ({ page, baseURL }) => {
  await signIn(page, 'light');
  const raceId = await createRace(page, baseURL!);
  await ownerCommand(page, baseURL!, {
    action: 'racePlan.create',
    values: { eventId: raceId, target: 'Finish comfortably', briefing: 'Easy start.' },
  });
  await page.goto(`/races?race=${raceId}`);
  await openRaceCard(page);
  await expect(page.getByRole('heading', { name: 'No race card yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toHaveCount(0);
});
