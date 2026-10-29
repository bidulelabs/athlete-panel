import { test, expect, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error('Set E2E_PASSWORD for the isolated synthetic browser-test instance.');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}

async function navigate(page: Page, title: string) {
  const opener = page.getByRole('button', { name: 'Open navigation' });
  if (await opener.isVisible()) await opener.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: title, exact: true })
    .click();
}

async function today(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

test('private pages and workspace data reject unauthenticated access', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/workspace?from=2026-10-19&to=2026-11-08');
  expect(response.status()).toBe(401);
  expect(await response.text()).not.toContain('workouts');
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('create, edit, log completion and reload a manual workout', async ({ page }, info) => {
  const title = `E2E ${info.project.name} ride ${Date.now()}`;
  await login(page);
  await page.getByRole('button', { name: 'Add workout', exact: true }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Workout title').fill(title);
  await create.getByRole('combobox', { name: 'Sport group', exact: true }).selectOption('running');
  await create.getByLabel('Duration · minutes', { exact: true }).fill('45');
  await create.getByLabel('Distance · km', { exact: true }).fill('8');
  await create.getByLabel('Scheduled date').fill(await today(page));
  await create.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(create).not.toBeVisible();
  const trigger = page.getByRole('button', { name: `Open ${title}`, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const inspector = page.getByRole('complementary', { name: 'Workout details' });
  await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit workout', exact: true });
  await edit.getByLabel('Workout description').fill('Keep the effort conversational.');
  await edit.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(inspector.getByText('Keep the effort conversational.')).toBeVisible();
  await inspector.getByRole('button', { name: 'Log workout', exact: true }).click();
  const completion = page.getByRole('dialog', { name: 'Log completion', exact: true });
  await completion.getByLabel('Actual duration · minutes').fill('42');
  await completion.getByLabel('Actual distance · km').fill('7.5');
  await completion.getByLabel('Perceived effort · RPE 1–10').fill('4');
  await completion.getByRole('button', { name: 'Save completion' }).click();
  await expect(completion).not.toBeVisible();
  await expect(inspector.locator('.completion-state')).toContainText('completed');
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  await expect(inspector.locator('.completion-state')).toContainText('completed');
  await expect(inspector.getByText('42m', { exact: true })).toBeVisible();
  await expect(inspector.getByText('7.5 km', { exact: true })).toBeVisible();
  await expect(inspector.getByText('4 / 10', { exact: true })).toBeVisible();
  if (info.project.name === 'mobile') {
    const rect = await inspector.boundingBox();
    expect(rect!.y).toBeGreaterThanOrEqual(50);
    expect(rect!.y).toBeLessThan(70);
    expect(rect!.height).toBeGreaterThan(600);
  }
});

test('plan-relative sessions persist with an explicit plan start', async ({ page }, info) => {
  const planTitle = `E2E ${info.project.name} block ${Date.now()}`;
  await login(page);
  await navigate(page, 'Training plans');
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Plan title').fill(planTitle);
  await dialog.getByLabel('Start date').fill(await today(page));
  await dialog.getByLabel('Description').fill('Synthetic browser test plan.');
  await dialog.getByRole('button', { name: 'Create plan', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('button', { name: `Open ${planTitle}`, exact: true });
  await row.click();
  const plan = page.getByRole('dialog', { name: planTitle, exact: true });
  await plan.getByRole('button', { name: 'Add workout', exact: true }).click();
  const workoutEditor = page.getByRole('dialog', { name: 'Add workout', exact: true });
  await workoutEditor.getByLabel('Workout title').fill(`${planTitle} session`);
  await workoutEditor.getByLabel('Duration · minutes', { exact: true }).fill('60');
  await workoutEditor.getByLabel('Day in plan').fill('2');
  await workoutEditor.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(workoutEditor).not.toBeVisible();
  await expect(
    plan.getByRole('button', { name: `Open ${planTitle} session`, exact: true }),
  ).toBeVisible();
  await page.reload();
  await row.click();
  await expect(
    plan.getByRole('button', { name: `Open ${planTitle} session`, exact: true }),
  ).toBeVisible();
  await expect(plan.getByRole('heading', { name: /Day 2/ })).toBeVisible();
});

test('keyboard dialog controls, theme persistence and failed-save recovery', async ({
  page,
}, info) => {
  await login(page);
  const theme = page.getByRole('button', {
    name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
    exact: true,
  });
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const add = page.getByRole('button', { name: 'Add workout', exact: true });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Workout title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await add.click();
  const title = `E2E retry ${info.project.name} ${Date.now()}`;
  await dialog.getByLabel('Workout title').fill(title);
  let failed = false;
  await page.route('**/api/plugins/training/mutate', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Synthetic outage. Please retry.' } }),
      });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic outage');
  await expect(dialog.getByLabel('Workout title')).toHaveValue(title);
  await dialog.getByRole('button', { name: 'Add workout', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: `Open ${title}`, exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('agent grants cannot apply changes and owner mutations reject foreign origins', async ({
  page,
  request,
}) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const date = await today(page);
  for (const operation of ['constructor', 'toString', '__proto__', 'unknown-operation']) {
    const response = await page.request.post(`/api/plugins/training/${operation}`, {
      headers: { Origin: origin },
      data: {},
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  }
  const grantResponse = await page.request.post('/api/plugins/agent-bridge/grant', {
    headers: { Origin: origin },
    data: {
      label: 'Synthetic browser permission check',
      from: date,
      to: date,
      includeNotes: false,
      expiresInHours: 1,
    },
  });
  expect(grantResponse.status()).toBe(200);
  const { token, grant } = await grantResponse.json();
  expect(typeof token).toBe('string');
  const context = await request.get('/api/agent/context', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(context.status()).toBe(200);
  const apply = await request.post('/api/agent/apply', {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(apply.status()).toBe(403);
  const ownerMutation = await request.post('/api/plugins/training/mutate', {
    headers: { Origin: origin, Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(ownerMutation.status()).toBe(401);
  const foreignOrigin = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: 'https://untrusted.invalid' },
    data: {},
  });
  expect(foreignOrigin.status()).toBe(403);
  const revoke = await page.request.post('/api/plugins/agent-bridge/revoke', {
    headers: { Origin: origin },
    data: { id: grant.id },
  });
  expect(revoke.status()).toBe(200);
  const revokedContext = await request.get('/api/agent/context', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(revokedContext.status()).toBe(401);
});
