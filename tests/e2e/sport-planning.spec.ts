import { test, expect } from '@playwright/test';
import { emptyWorkspace, workoutSchema, activitySchema } from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { calendarFixture, calendarId } from '../fixtures/calendar';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

for (const theme of ['dark', 'light'] as const) {
  test(`sport planning, strength, rest and linking in ${theme}`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let data = emptyWorkspace();
    data.profile = calendarFixture().profile;
    data.profile!.units = theme === 'light' ? 'imperial' : 'metric';
    data.workouts = [
      workoutSchema.parse({
        id: calendarId(501),
        revision: 1,
        title: 'Alpine ascent',
        sport: 'other',
        sportSubgroup: 'mountaineering',
        plannedElevationGainMeters: 1000,
        notes: 'Route description\nCheck conditions.',
        schedule: { kind: 'independent', date: '2030-01-07' },
        exercises: [
          {
            name: 'Step-up',
            sets: 3,
            repetitions: '8–10',
            weightKg: 10,
            loadDescription: 'per hand',
            restSeconds: 60,
            instructions: 'Slow descent.\nKeep balance.',
          },
        ],
        completion: {
          source: 'manual',
          activityId: null,
          status: 'partial',
          performedDate: '2030-01-07',
          reason: 'Weather',
          notes: 'Turned around safely.',
          rpe: 7,
        },
      }),
      workoutSchema.parse({
        id: calendarId(502),
        revision: 1,
        title: 'Recovery day',
        kind: 'rest',
        sport: null,
        schedule: { kind: 'independent', date: '2030-01-08' },
      }),
    ];
    const activity = {
      revision: 1,
      provider: 'garmin',
      title: 'Mountain record',
      sport: 'other',
      sportSubgroup: 'mountaineering',
      sportResolution: 'resolved',
      startedAt: '2030-01-07T09:00:00Z',
      localDate: '2030-01-07',
      dateSource: 'provider',
      durationSeconds: 3600,
      distanceMeters: 6000,
      elevationMeters: 800,
      averageHeartRateBpm: null,
      trainingStressScore: 0,
      intensityFactor: 1.1,
      normalizedPowerWatts: 230,
    };
    data.activities = [
      activitySchema.parse({ ...activity, id: calendarId(503), externalId: '555:503' }),
      activitySchema.parse({
        ...activity,
        id: calendarId(504),
        externalId: '555:504',
        title: 'Hiking record',
        sport: 'hiking',
        sportSubgroup: null,
      }),
    ];
    await page.clock.setFixedTime(new Date('2030-01-09T12:00:00Z'));
    await page.route('**/api/workspace?**', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), state: data } });
    });
    await page.route('**/api/plugins/training/mutate', async (route) => {
      const result = applyCommands(data, route.request().postDataJSON().commands, {
        actor: 'owner',
      });
      data = result.state;
      await route.fulfill({ json: { id: calendarId(599), changes: result.changes } });
    });
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.getByLabel('Go to date').fill('2030-01-07');
    await page.getByRole('button', { name: 'Open Alpine ascent', exact: true }).click();
    const inspector = page.getByRole('complementary', { name: 'Workout details' });
    await expect(inspector).toContainText('Other · Mountaineering');
    await expect(inspector.getByRole('region', { name: 'Strength prescription' })).toContainText(
      theme === 'light' ? '22.05 lb' : '10 kg',
    );
    await expect(inspector).toContainText('Turned around safely.');
    await inspector.getByRole('button', { name: 'Link activity', exact: true }).click();
    const link = page.getByRole('dialog', { name: 'Link an activity', exact: true });
    await expect(link.getByRole('combobox')).toContainText('Mountain record');
    await expect(link.getByRole('combobox')).not.toContainText('Hiking record');
    await link.getByRole('combobox').selectOption(calendarId(503));
    await link.getByRole('button', { name: 'Link activity', exact: true }).click();
    await expect(link).not.toBeVisible();
    await expect(inspector).toContainText('partial');
    await expect(inspector).toContainText('Turned around safely.');
    await expect(inspector).toContainText('230');
    await inspector.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      animations: 'disabled',
      path: `.runtime/sport-review/${info.project.name}-${theme}-inspector.png`,
    });
    await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit workout', exact: true });
    await expect(editor.getByRole('combobox', { name: 'Sport group', exact: true })).toHaveValue(
      'other',
    );
    await expect(editor.getByRole('combobox', { name: 'Sport subgroup', exact: true })).toHaveValue(
      'mountaineering',
    );
    await editor.getByLabel('Workout description').fill('Updated\nMultiline description');
    await editor.getByLabel('Exercise name').scrollIntoViewIfNeeded();
    await editor
      .getByLabel(theme === 'light' ? 'Weight · lb' : 'Weight · kg', { exact: true })
      .fill(theme === 'light' ? '22' : '10');
    await page.screenshot({
      animations: 'disabled',
      path: `.runtime/sport-review/${info.project.name}-${theme}-exercises.png`,
    });
    await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(inspector).toContainText('Updated');
    expect(data.workouts[0]!.exercises![0]!.weightKg).toBeCloseTo(
      theme === 'light' ? 9.97903214 : 10,
      5,
    );
    await inspector.getByRole('button', { name: 'Close workout details' }).click();
    await page.getByRole('button', { name: 'Open Recovery day', exact: true }).click();
    await expect(inspector).toContainText('Rest day');
    await expect(inspector.getByRole('button', { name: 'Log workout', exact: true })).toHaveCount(
      0,
    );
    await inspector.getByRole('button', { name: 'Close workout details' }).click();
    const week = page.locator('.calendar-week').first();
    await week.locator('.week-summary-toggle').click();
    await week.getByRole('button', { name: 'Show details', exact: true }).click();
    const breakdown = week.getByRole('region', { name: 'Sport group and subgroup summary' });
    await expect(breakdown).toContainText('Hiking');
    await expect(breakdown).toContainText('Other · Mountaineering');
    await breakdown.screenshot({
      path: `.runtime/sport-review/${info.project.name}-${theme}-summary.png`,
    });
    await page.getByRole('button', { name: 'Add workout', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Add workout', exact: true });
    await create.getByRole('combobox', { name: 'Sport group', exact: true }).selectOption('hiking');
    await expect(
      create.getByRole('combobox', { name: 'Sport subgroup', exact: true }),
    ).not.toContainText('Mountaineering');
    await page.screenshot({
      animations: 'disabled',
      path: `.runtime/sport-review/${info.project.name}-${theme}-editor.png`,
    });
    await create.getByRole('combobox', { name: 'Planning kind', exact: true }).selectOption('rest');
    await expect(create.getByRole('combobox', { name: 'Sport group', exact: true })).toHaveCount(0);
    await expect(create.getByLabel('Duration · minutes', { exact: true })).toHaveCount(0);
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
    const nav = page.getByRole('button', { name: 'Open navigation' });
    if (await nav.isVisible()) await nav.click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Activities', exact: true })
      .click();
    await page.getByLabel('Filter activities by sport', { exact: true }).selectOption('other');
    await page
      .getByLabel('Filter activities by subgroup', { exact: true })
      .selectOption('mountaineering');
    await expect(page.getByText('Mountain record', { exact: true })).toBeVisible();
    await expect(page.getByText('Hiking record', { exact: true })).toHaveCount(0);
    await page.screenshot({
      animations: 'disabled',
      path: `.runtime/sport-review/${info.project.name}-${theme}-activities.png`,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
