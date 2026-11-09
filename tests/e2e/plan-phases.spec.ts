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
  await expect(header.getByRole('region', { name: 'Week 1' })).toContainText(`${title} session`);

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
