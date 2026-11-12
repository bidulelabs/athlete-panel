import { test, expect, type Page } from '@playwright/test';
import { emptyWorkspace, profileSchema, workoutSchema } from '@athlete-panel/contracts';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

const workoutId = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function workspaceWithWorkouts(workouts: ReturnType<typeof workoutSchema.parse>[]) {
  const state = emptyWorkspace();
  state.profile = profileSchema.parse({
    id: 'owner',
    revision: 1,
    displayName: 'Alex Morgan',
    timezone: 'Europe/Paris',
    weekStartsOnPreference: 'monday',
  });
  state.workouts = workouts;
  return state;
}

function workoutOnDate(
  id: number,
  fields: { title: string; date: string; sport: string | null } & Record<string, unknown>,
) {
  const { date, ...rest } = fields;
  return workoutSchema.parse({
    id: workoutId(id),
    revision: 1,
    schedule: { kind: 'independent', date },
    ...rest,
  });
}

async function openCalendarWithState(page: Page, state: ReturnType<typeof workspaceWithWorkouts>) {
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    await route.fulfill({ response, json: { ...envelope, state } });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.getByLabel('Go to date').fill('2030-01-08');
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function openWeekWithOneWorkoutPerStatus(page: Page) {
  await openCalendarWithState(
    page,
    workspaceWithWorkouts([
      workoutOnDate(1, {
        title: 'Hill repeats',
        date: '2030-01-08',
        sport: 'running',
        durationSeconds: 3600,
        completion: {
          status: 'partial',
          source: 'manual',
          activityId: null,
          performedDate: '2030-01-08',
          durationSeconds: 1800,
          reason: 'Legs felt heavy',
        },
      }),
      workoutOnDate(2, {
        title: 'Tempo run',
        date: '2030-01-09',
        sport: 'running',
        durationSeconds: 2700,
        completion: {
          status: 'skipped',
          source: 'manual',
          activityId: null,
          performedDate: '2030-01-09',
        },
      }),
      workoutOnDate(3, {
        title: 'Recovery day',
        date: '2030-01-10',
        kind: 'rest',
        sport: null,
      }),
      workoutOnDate(4, {
        title: 'Long ride',
        date: '2030-01-11',
        sport: 'cycling',
        durationSeconds: 7200,
        completion: {
          status: 'completed',
          source: 'manual',
          activityId: null,
          performedDate: '2030-01-12',
          durationSeconds: 7000,
        },
      }),
    ]),
  );
}

const dayCell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

test('workout buttons are named by title and described by status', async ({ page }) => {
  await openWeekWithOneWorkoutPerStatus(page);
  const hillRepeats = dayCell(page, '2030-01-08').getByRole('button', {
    name: 'Open Hill repeats',
  });
  await expect(hillRepeats).toHaveAccessibleDescription(/Partial/);
  const tempoRun = dayCell(page, '2030-01-09').getByRole('button', { name: 'Open Tempo run' });
  await expect(tempoRun).toHaveAccessibleDescription(/Skipped/);
  const recoveryDay = dayCell(page, '2030-01-10').getByRole('button', {
    name: 'Open Recovery day',
  });
  await expect(recoveryDay).toHaveAccessibleDescription(/Rest/);
  const plannedLongRide = dayCell(page, '2030-01-11').getByRole('button', {
    name: 'Open Long ride',
  });
  await expect(plannedLongRide).toHaveAccessibleDescription(/Completed/);
  const recordedLongRide = dayCell(page, '2030-01-12').getByRole('button', {
    name: 'Open actual Long ride',
  });
  await expect(recordedLongRide).toHaveAccessibleDescription(/Completed/);
});

test('each day is a group named by its full date', async ({ page }) => {
  await openWeekWithOneWorkoutPerStatus(page);
  await expect(page.getByRole('group', { name: /^Tuesday,? 8 January$/ })).toHaveAttribute(
    'data-date',
    '2030-01-08',
  );
});

test('the add button on an empty day names its date', async ({ page }) => {
  await openWeekWithOneWorkoutPerStatus(page);
  await expect(
    dayCell(page, '2030-01-13').getByRole('button', { name: 'Add workout on 13 Jan' }),
  ).toHaveCount(1);
});

test('headings go h1 then h2 with no skipped level', async ({ page }) => {
  await openCalendarWithState(page, workspaceWithWorkouts([]));
  await expect(
    page.getByRole('heading', { level: 2, name: 'A clear week starts here.' }),
  ).toBeVisible();
  const headingLevels = await page
    .locator('.page-content')
    .getByRole('heading')
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
  expect(headingLevels[0]).toBe(1);
  headingLevels
    .slice(1)
    .forEach((level, index) => expect(level - headingLevels[index]).toBeLessThanOrEqual(1));
});
