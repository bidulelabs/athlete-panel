import { test, expect, type Locator, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}

async function addFourWeekBuild(page: Page, plan: Locator, name: string, start: string) {
  await plan.getByRole('button', { name: 'Add phase' }).click();
  const editor = page.getByRole('dialog', { name: 'Add a phase' });
  await editor.getByLabel('Name').fill(name);
  await editor.getByLabel('Role').selectOption('build');
  await editor.getByLabel('Last day').fill(addDays(start, 27));
  await editor.getByRole('checkbox', { name: 'Set a weekly hours target' }).click();
  const hours = editor.getByRole('group', { name: 'Weekly hours · h' });
  await hours.getByLabel('First week, at least').fill('8');
  await hours.getByLabel('First week, at most').fill('10');
  await hours.getByLabel('Last week, at least').fill('11');
  await hours.getByLabel('Last week, at most').fill('13');
  await editor.getByRole('button', { name: 'Add phase' }).click();
  await expect(editor).toBeHidden();
}

async function expectChartsTargets(page: Page, start: string, targets: string[]) {
  await page.goto('/charts');
  await page.getByRole('button', { name: /^Training hours/ }).click();
  await page.getByRole('combobox', { name: 'Period' }).selectOption('custom');
  await page.getByRole('textbox', { name: 'From' }).fill(start);
  await page.getByRole('textbox', { name: 'To' }).fill(addDays(start, 27));
  const figure = page.getByRole('figure').first();
  await figure.getByText('View values', { exact: true }).click();
  await expect(figure.getByRole('row')).toContainText(targets);
}

test.use({ locale: 'en-GB' });

test('lower week 3 of a four-week build, then reset it to calculated', async ({ page }, info) => {
  const start = info.project.name === 'mobile' ? '2036-01-07' : '2035-01-01';
  const title = `E2E edited week ${info.project.name} ${Date.now()}`;
  const name = `Build ${Date.now()}`;
  await signIn(page);
  await page.goto('/plans');
  await page.getByRole('button', { name: 'Create plan' }).click();
  const planForm = page.getByRole('dialog', { name: 'Create a training plan' });
  await planForm.getByLabel('Plan title').fill(title);
  await planForm.getByLabel('Start date').fill(start);
  await planForm.getByRole('button', { name: 'Create plan' }).click();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const plan = page.getByRole('dialog', { name: title });
  await addFourWeekBuild(page, plan, name, start);

  const phase = plan.getByRole('group', { name: `${name} phase` });
  const week = (number: number) =>
    phase.getByRole('region', { name: `Week ${number}`, exact: true });
  await expect(week(3)).toContainText('Target 10–12 h');
  await week(3)
    .getByRole('button', { name: /^Edit target for the week of / })
    .click();
  const weekEditor = page.getByRole('dialog', { name: new RegExp(`^Week of .* in ${name}$`) });
  const hours = weekEditor.getByRole('group', { name: 'Weekly hours · h' });
  await hours.getByRole('checkbox', { name: 'Set this week by hand' }).click();
  await expect(hours.getByLabel('At least')).toHaveValue('10');
  await hours.getByLabel('At least').fill('6');
  await hours.getByLabel('At most').fill('8');
  await weekEditor.getByRole('button', { name: 'Save week' }).click();
  await expect(weekEditor).toBeHidden();
  await expect(week(3)).toContainText('6–8 h');
  await expect(week(3)).toContainText('Edited');
  for (const [number, target] of [
    [1, '8–10 h'],
    [2, '9–11 h'],
    [4, '11–13 h'],
  ] as const) {
    await expect(week(number)).toContainText(target);
    await expect(week(number)).not.toContainText('Edited');
  }

  await phase.getByRole('button', { name: `Edit ${name}` }).click();
  const phaseEditor = page.getByRole('dialog', { name: 'Edit phase' });
  await phaseEditor.getByLabel('Last day').fill(addDays(start, 20));
  await expect(phaseEditor.getByRole('status')).toHaveCount(0);
  await phaseEditor.getByLabel('Last day').fill(addDays(start, 12));
  await expect(phaseEditor.getByRole('status')).toContainText('Saving drops the edited week of');
  await phaseEditor.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/');
  await page.getByLabel('Go to date').fill(addDays(start, 7));
  await expect(
    page.locator('.calendar-week').getByRole('button', { name: /^Duration:/ }),
  ).toContainText(['Target 9–11 h', 'Target 6–8 h', 'Target 11–13 h']);
  await expectChartsTargets(page, start, ['8h–10h', '9h–11h', '6h–8h', '11h–13h']);

  await page.goto('/plans');
  await page.getByRole('button', { name: `Open ${title}` }).click();
  await week(3)
    .getByRole('button', { name: /^Reset target for the week of .* to calculated$/ })
    .click();
  await expect(week(3)).toContainText('10–12 h');
  await expect(week(3)).not.toContainText('Edited');

  await phase.getByRole('button', { name: `Edit ${name}` }).click();
  await phaseEditor.getByRole('checkbox', { name: 'Set a weekly hours target' }).click();
  await phaseEditor.getByRole('button', { name: 'Save phase' }).click();
  await expect(phaseEditor).toBeHidden();
  await expect(week(1)).toContainText('No target');
  await week(1)
    .getByRole('button', { name: /^Edit target for the week of / })
    .click();
  await hours.getByRole('checkbox', { name: 'Set this week by hand' }).click();
  await hours.getByLabel('At least').fill('4');
  await hours.getByLabel('At most').fill('5');
  await weekEditor.getByRole('button', { name: 'Save week' }).click();
  await expect(weekEditor).toBeHidden();
  await expect(week(1)).toContainText('4–5 h');
  await expect(week(1)).toContainText('Edited');
  await expect(week(2)).toContainText('No target');

  await plan.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await plan.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: `Open ${title}` })).toHaveCount(0);
});
