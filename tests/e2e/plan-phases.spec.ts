import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function openPlans(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: 'Training plans' })).toBeVisible();
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

async function mutate(page: Page, commands: unknown[]) {
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: new URL(page.url()).origin },
    data: { idempotencyKey: randomUUID(), commands },
  });
  expect(response.ok()).toBe(true);
}

async function workspaceState(page: Page, from: string) {
  const response = await page.request.get(`/api/workspace?from=${from}&to=${addDays(from, 60)}`);
  expect(response.ok()).toBe(true);
  const { state } = await response.json();
  return state as {
    plans: Array<{ id: string; revision: number }>;
    periods: Array<{ id: string; revision: number; startDate: string; endDate: string }>;
  };
}

async function deleteAll(page: Page, from: string, planIds: string[], periodIds: string[]) {
  const state = await workspaceState(page, from);
  await mutate(page, [
    ...state.periods
      .filter((period) => periodIds.includes(period.id))
      .map((period) => ({
        action: 'period.delete',
        id: period.id,
        expectedRevision: period.revision,
      })),
    ...state.plans
      .filter((plan) => planIds.includes(plan.id))
      .map((plan) => ({ action: 'plan.delete', id: plan.id, expectedRevision: plan.revision })),
  ]);
}

const hours = (first: number, last: number) => ({
  firstWeek: { min: first * 3600, max: (first + 2) * 3600 },
  lastWeek: { min: last * 3600, max: (last + 2) * 3600 },
});

async function fillTargetFields(
  page: Page,
  group: string,
  values: [number, number, number, number],
) {
  const fields = page.getByRole('group', { name: group });
  const labels = [
    'First week, at least',
    'First week, at most',
    'Last week, at least',
    'Last week, at most',
  ];
  for (const [index, label] of labels.entries())
    await fields.getByLabel(label).fill(String(values[index]));
}

test('add, edit and delete phases that contain their weeks inside a scheduled plan', async ({
  page,
}, info) => {
  const year = info.project.name === 'mobile' ? 2032 : 2031;
  const title = `E2E phases ${info.project.name} ${Date.now()}`;
  const name = `Base ${Date.now()}`;
  await openPlans(page);
  await page.getByRole('button', { name: 'Create plan' }).click();
  const planForm = page.getByRole('dialog', { name: 'Create a training plan' });
  await planForm.getByLabel('Plan title').fill(title);
  await planForm.getByLabel('Start date').fill(`${year}-01-05`);
  await planForm.getByRole('button', { name: 'Create plan' }).click();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const plan = page.getByRole('dialog', { name: title });

  await plan.getByRole('button', { name: 'Add phase' }).click();
  const editor = page.getByRole('dialog', { name: 'Add a phase' });
  await expect(editor.getByLabel('First day')).toHaveValue(`${year}-01-05`);
  await editor.getByLabel('Name').fill(name);
  await editor.getByLabel('Role').selectOption('build');
  await editor.getByLabel('Focus').fill('VO2max');
  await editor.getByLabel('Last day').fill(`${year}-02-27`);
  await expect(editor.getByRole('spinbutton')).toHaveCount(0);
  await editor.getByRole('checkbox', { name: 'Set a weekly hours target' }).click();
  await fillTargetFields(page, 'Weekly hours · h', [8.25, 10, 14, 15]);
  await editor.getByRole('checkbox', { name: 'Set a weekly distance target' }).click();
  await fillTargetFields(page, 'Weekly distance · km', [50, 50, 70, 70]);
  await editor.getByRole('button', { name: 'Add phase' }).click();
  await expect(editor).toBeHidden();

  const header = plan.getByRole('group', { name: `${name} phase` });
  await expect(header).toContainText('Build');
  await expect(header).toContainText('VO2max');
  await expect(header).toContainText('Target 8.3–10 → 14–15 h a week');
  await expect(header).toContainText('Target 50 → 70 km a week');
  await plan.getByRole('button', { name: 'Add first workout', exact: true }).click();
  const workoutEditor = page.getByRole('dialog', { name: 'Add workout', exact: true });
  await workoutEditor.getByLabel('Workout title').fill(`${title} session`);
  await workoutEditor.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(workoutEditor).toBeHidden();
  await expect(header.getByRole('region', { name: 'Week 1', exact: true })).toContainText(
    `${title} session`,
  );

  await header.getByRole('button', { name: `Edit ${name}` }).click();
  const edit = page.getByRole('dialog', { name: 'Edit phase' });
  await edit.getByRole('checkbox', { name: 'Set a weekly distance target' }).click();
  await edit.getByRole('button', { name: 'Save phase' }).click();
  await expect(edit).toBeHidden();
  await expect(header).toContainText('Target 8.3–10 → 14–15 h a week');
  await expect(header).not.toContainText('km a week');
  await header.getByRole('button', { name: `Edit ${name}` }).click();
  await expect(edit.getByLabel('First week, at least')).toHaveValue('8.25');
  await edit.getByRole('button', { name: 'Cancel' }).click();

  await plan.getByRole('button', { name: 'Add phase' }).click();
  await expect(editor.getByLabel('First day')).toHaveValue(`${year}-02-28`);
  await editor.getByLabel('Name').fill(`Taper ${name}`);
  await editor.getByLabel('Role').selectOption('taper');
  await editor.getByLabel('Last day').fill(`${year}-03-14`);
  await editor.getByRole('button', { name: 'Add phase' }).click();
  const taper = plan.getByRole('group', { name: `Taper ${name} phase` });
  await expect(taper).toContainText('Taper');
  await expect(taper).not.toContainText('Target');

  for (const phase of [name, `Taper ${name}`]) {
    await plan.getByRole('button', { name: `Delete ${phase}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(plan.getByRole('group', { name: `${phase} phase` })).toHaveCount(0);
  }
  await plan.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toHaveCount(0);
});

test('a plan starting midweek shows calendar weeks apart from its own weeks', async ({
  page,
}, info) => {
  const start = info.project.name === 'mobile' ? '2042-01-01' : '2041-01-02';
  const title = `E2E midweek ${info.project.name} ${Date.now()}`;
  const planId = randomUUID();
  const phaseId = randomUUID();
  await openPlans(page);
  await mutate(page, [
    { action: 'plan.create', values: { id: planId, title, startDate: start } },
    {
      action: 'period.create',
      values: {
        id: phaseId,
        name: `Midweek build ${Date.now()}`,
        role: 'build',
        startDate: start,
        endDate: addDays(start, 27),
        weeklyDurationSeconds: hours(8, 8),
      },
    },
  ]);
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const plan = page.getByRole('dialog', { name: title });
  await plan.getByRole('button', { name: 'Add first workout', exact: true }).click();
  const workoutEditor = page.getByRole('dialog', { name: 'Add workout', exact: true });
  await workoutEditor.getByLabel('Workout title').fill(`${title} session`);
  await workoutEditor.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(workoutEditor).toBeHidden();

  const planWeek = plan.getByRole('region', { name: 'Week 1', exact: true });
  await expect(planWeek).toContainText(`${title} session`);
  await expect(planWeek).not.toContainText('Target');
  const calendarWeeks = plan.getByRole('region', { name: /^Calendar week of / });
  await expect(calendarWeeks).toHaveCount(4);
  await expect(calendarWeeks.first()).toContainText('Calendar week');
  await expect(calendarWeeks.first()).toContainText('Target 8–10 h');
  await expect(
    calendarWeeks.first().getByRole('button', { name: /^Edit target for the week of / }),
  ).toBeVisible();

  await deleteAll(page, start, [planId], [phaseId]);
});

test('moving a plan offers to move its own phases and names the shared ones', async ({
  page,
}, info) => {
  const start = info.project.name === 'mobile' ? '2042-03-03' : '2041-03-04';
  const stamp = Date.now();
  const title = `E2E move ${info.project.name} ${stamp}`;
  const next = `E2E next ${info.project.name} ${stamp}`;
  const [planId, nextId, ownId, sharedId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const own = `Own ${stamp}`;
  const shared = `Shared ${stamp}`;
  await openPlans(page);
  await mutate(page, [
    { action: 'plan.create', values: { id: planId, title, startDate: start } },
    { action: 'plan.create', values: { id: nextId, title: next, startDate: addDays(start, 14) } },
    {
      action: 'period.create',
      values: {
        id: ownId,
        name: own,
        role: 'base',
        startDate: start,
        endDate: addDays(start, 6),
        weeklyDurationSeconds: hours(6, 6),
      },
    },
    {
      action: 'period.create',
      values: {
        id: sharedId,
        name: shared,
        role: 'build',
        startDate: addDays(start, 7),
        endDate: addDays(start, 20),
      },
    },
  ]);
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const plan = page.getByRole('dialog', { name: title });

  await plan.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Phases and their weekly targets stay on their dates and are not copied',
  );
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

  await plan.getByRole('button', { name: 'Edit plan' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit training plan' });
  await expect(editor.getByRole('group', { name: 'Phases and weekly targets' })).toHaveCount(0);
  await editor.getByLabel('Start date').fill(addDays(start, -7));
  const choice = editor.getByRole('group', { name: 'Phases and weekly targets' });
  await expect(choice.getByRole('radio', { name: `Keep “${own}” on its dates` })).toBeChecked();
  await expect(choice.getByRole('status')).toHaveText(
    `“${shared}” is shared with “${next}” and stays on its dates.`,
  );
  await choice.getByRole('radio', { name: `Move “${own}” with the plan` }).check();
  await editor.getByRole('button', { name: 'Save plan' }).click();
  await expect(editor).toBeHidden();

  const moved = await workspaceState(page, addDays(start, -7));
  expect(moved.periods.find((period) => period.id === ownId)).toMatchObject({
    startDate: addDays(start, -7),
    endDate: addDays(start, -1),
  });
  expect(moved.periods.find((period) => period.id === sharedId)).toMatchObject({
    startDate: addDays(start, 7),
    endDate: addDays(start, 20),
  });

  await deleteAll(page, addDays(start, -7), [planId, nextId], [ownId, sharedId]);
});
