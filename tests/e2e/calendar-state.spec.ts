import { test, expect, type Page } from '@playwright/test';
import { activitySchema, workoutSchema } from '@athlete-panel/contracts';
import { applyCommands } from '../../plugins/training/engine';
import { calendarFixture, calendarId as id } from '../fixtures/calendar';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function preview(page: Page) {
  let state = calendarFixture();
  state.health = [];
  state.notes = [];
  state.injuries = [];
  state.events = [];
  state.workouts[0]!.completion!.linkMethod = 'automatic';
  const workout = (n: number, title: string, date: string, extra = {}) =>
    workoutSchema.parse({
      id: id(n),
      revision: 1,
      title,
      sport: 'running',
      schedule: { kind: 'independent', date },
      durationSeconds: 2700,
      distanceMeters: 8000,
      ...extra,
    });
  const manual = {
    status: 'completed',
    source: 'manual',
    activityId: null,
    performedDate: '2030-01-09',
    durationSeconds: 2400,
    distanceMeters: 7500,
  };
  state.workouts.push(
    workout(101, 'Same-day run', '2030-01-06'),
    workout(102, 'Other-day run', '2030-01-08'),
    workout(103, 'Manual run', '2030-01-09', { completion: manual }),
    workout(104, 'Partial moved run', '2030-01-09', {
      order: 2,
      completion: {
        ...manual,
        status: 'partial',
        reason: 'Short on time',
        performedDate: '2030-01-10',
      },
    }),
    workout(105, 'Skipped run', '2030-01-11', {
      completion: {
        ...manual,
        status: 'skipped',
        performedDate: '2030-01-11',
        durationSeconds: null,
        distanceMeters: null,
      },
    }),
    workout(106, 'Rest day', '2030-01-12', {
      kind: 'rest',
      sport: null,
      durationSeconds: null,
      distanceMeters: null,
    }),
    workout(107, 'Missing recorded duration', '2030-01-13', {
      completion: {
        ...manual,
        performedDate: '2030-01-13',
        durationSeconds: null,
        distanceMeters: 0,
      },
    }),
    workout(108, 'Partial linked run', '2030-01-11', {
      completion: {
        ...manual,
        status: 'partial',
        source: 'garmin',
        reason: 'Shortened session',
        activityId: id(109),
        linkMethod: 'automatic',
        performedDate: '2030-01-12',
      },
    }),
  );
  state.activities.push(
    activitySchema.parse({
      ...state.activities[1],
      id: id(109),
      externalId: 'synthetic-partial',
      title: 'Shortened Garmin run',
      localDate: '2030-01-12',
      startedAt: '2030-01-12T10:00:00Z',
      durationSeconds: 2400,
      distanceMeters: 7500,
    }),
  );
  const requests: { commands: { id: string; expectedRevision: number }[] }[] = [];
  let fail = false;
  await page.clock.setFixedTime(new Date('2030-01-13T12:00:00Z'));
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), state } });
  });
  await page.route('**/api/plugins/training/mutate', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (fail)
      return route.fulfill({
        status: 409,
        json: {
          error: { code: 'STALE_REVISION', message: 'This workout changed. Reload before saving.' },
        },
      });
    const result = applyCommands(state, body.commands, { actor: 'owner' });
    state = result.state;
    await route.fulfill({ json: { id: crypto.randomUUID(), changes: result.changes } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Go to date').fill('2030-01-06');
  await expect(
    page.getByRole('button', { name: 'Open Steady endurance ride', exact: true }),
  ).toBeVisible();
  return {
    requests,
    fail: (value: boolean) => {
      fail = value;
    },
    advance: () => {
      state.workouts.find((w) => w.id === id(101))!.revision++;
    },
  };
}

test('all completion and linking states stay explicit across widths and themes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'This matrix includes desktop and phone widths.');
  const { requests } = await preview(page);
  const linked = page.getByRole('button', { name: 'Open Steady endurance ride', exact: true });
  await expect(linked).toContainText('Completed');
  await expect(linked).toContainText('Garmin linked');
  await expect(linked).toContainText('Recorded 1h 2m · 30.0 km');
  await expect(linked).toContainText('Planned 1h');
  await expect(linked).toHaveAccessibleDescription(/Completed.*Recorded.*Planned.*Garmin linked/);
  await expect(
    page.getByRole('button', { name: 'Open activity Morning ride', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Manual run', exact: true })).toContainText(
    'Logged manually',
  );
  const partial = page.getByRole('button', { name: 'Open actual Partial moved run', exact: true });
  await expect(partial).toContainText('Partial');
  await expect(partial).not.toContainText('Completed');
  await expect(partial).toContainText('Planned 9 Jan');
  await expect(
    page.getByRole('button', { name: 'Open Partial moved run', exact: true }),
  ).toContainText('Performed 10 Jan');
  const linkedPartial = page.getByRole('button', {
    name: 'Open actual Partial linked run',
    exact: true,
  });
  await expect(linkedPartial).toContainText('Partial');
  await expect(linkedPartial).toContainText('Garmin linked');
  await expect(linkedPartial).toContainText('Planned 11 Jan');
  await expect(linkedPartial).not.toContainText('Completed');
  await expect(
    page.getByRole('button', { name: 'Open Partial linked run', exact: true }),
  ).toContainText('Performed 12 Jan');
  await expect(
    page.getByRole('button', { name: 'Open activity Shortened Garmin run', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open Skipped run', exact: true }),
  ).not.toContainText('Recorded');
  await expect(page.getByRole('button', { name: 'Open Rest day', exact: true })).not.toContainText(
    'Planned',
  );
  await expect(
    page.getByRole('button', { name: 'Open Missing recorded duration', exact: true }),
  ).toContainText('Recorded Unavailable · 0.0 km');
  for (const width of [320, 390, 1100, 1440, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await linked.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await linked.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.inspector-frame')).toHaveAttribute(
        'data-overlay',
        String(width < 1536),
      );
      await expect(page.getByText('Linked automatically by day and sport.')).toBeVisible();
      expect(
        (await page.locator('.calendar-session').first().boundingBox())!.width,
      ).toBeGreaterThan(110);
      await page.keyboard.press('Escape');
      await expect(linked).toBeFocused();
      await page.screenshot({
        path: `.runtime/calendar-linking/calendar-${width}-${theme}.png`,
        animations: 'disabled',
      });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await linked.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(requests).toHaveLength(0);
});

test('activity-first linking sorts same-day workouts first and refreshes the combined card', async ({
  page,
}) => {
  const { requests } = await preview(page);
  await page.getByRole('button', { name: 'Open activity River path run', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'River path run', exact: true });
  await activity.getByRole('button', { name: 'Link workout', exact: true }).click();
  const linking = page.getByRole('dialog', { name: 'Link workout', exact: true });
  await expect(linking.locator('option').nth(1)).toContainText('Same day');
  await linking.getByRole('combobox', { name: 'Workout', exact: true }).selectOption(id(101));
  await linking.getByRole('button', { name: 'Link workout', exact: true }).click();
  await expect(linking).not.toBeVisible();
  await expect(activity.getByRole('button', { name: 'Same-day run', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const card = page.getByRole('button', { name: 'Open Same-day run', exact: true });
  await expect(card).toContainText('Garmin linked');
  await expect(card).toContainText('Recorded 45m · 8.0 km');
  await expect(
    page.getByRole('button', { name: 'Open activity River path run', exact: true }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test('stale link drafts retain their selected workout and original revision through reload recovery', async ({
  page,
}) => {
  const state = await preview(page);
  await page.getByRole('button', { name: 'Open activity River path run', exact: true }).click();
  await page.getByRole('button', { name: 'Link workout', exact: true }).click();
  const linking = page.getByRole('dialog', { name: 'Link workout', exact: true });
  await linking.getByRole('combobox', { name: 'Workout', exact: true }).selectOption(id(101));
  state.fail(true);
  state.advance();
  await linking.getByRole('button', { name: 'Link workout', exact: true }).click();
  await expect(linking.getByRole('alert')).toBeVisible();
  await linking.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(linking.getByRole('combobox', { name: 'Workout', exact: true })).toHaveValue(
    id(101),
  );
  await linking.getByRole('button', { name: 'Link workout', exact: true }).click();
  expect(state.requests.map((r) => r.commands[0]!.expectedRevision)).toEqual([1, 1]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'River path run', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link workout', exact: true })).toBeFocused();
});
